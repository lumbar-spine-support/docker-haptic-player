import type { Funscript, FunscriptAction } from '../../shared/types';
import type { HapticChannel } from '../../shared/haptics';
import { bracketIndex, DEFAULT_INTERPOLATION_METHOD, positionAt, prepareScript, type InterpolationMethod, type PreparedScript } from '../../shared/interpolation';
import type { HapticBackend } from './haptic/backend';
import type { PlaybackSession } from './player';

/** Travel time for a stroker jump without interpolation; as fast as devices reliably accept. */
const STEP_MOVE_MS = 50;

interface LoadedScript {
  channel: HapticChannel;
  source: readonly FunscriptAction[];
  prepared: PreparedScript;
  /** performance.now() timestamp before which no new linear move should be issued. */
  moveLockedUntil: number;
  /** Last position (0–1) sent for a linear (stroker) role; avoids redundant re-sends. */
  lastSentPos: number | null;
}

/**
 * Drives haptic device output in sync with the audio timeline.
 *
 * Output style follows the assigned *actuator*, not the script type: scalar and
 * rotate actuators get continuously resampled values, linear actuators get
 * edge-triggered moves. The same script can therefore drive a vibrator and a
 * stroker at once, and one toy's actuators can follow different scripts.
 *
 * Continuously resampled actuators work as follows: every tick recomputes the
 * interpolated intensity for the current time and resends it, even if unchanged.
 * This makes the output self-correcting — a single dropped BLE write is fixed by
 * the next tick — instead of relying on one-shot edge-triggered commands that can
 * leave a device stuck "on" if the off command doesn't land.
 *
 * Linear (stroker) moves stay edge-triggered, but the move duration matches the
 * actual gap to the next waypoint and a new move is withheld until the previous
 * one should have completed, so closely spaced points can't stack/interrupt
 * each other mid-motion.
 *
 * Extension points:
 *  - per-funscript type → device routing table
 *  - synchronization offset (delay ms)
 */
export class FunscriptSync {
  private scripts: LoadedScript[] = [];
  private rafHandle = 0;
  private timerHandle: number | null = null;
  private isPlaying = false;
  private delayMs = 0;
  private updateIntervalMs = 1000 / 30;
  private interpolation: InterpolationMethod = DEFAULT_INTERPOLATION_METHOD;
  private readonly session: PlaybackSession;
  private readonly buttplug: HapticBackend;

  constructor(session: PlaybackSession, buttplug: HapticBackend) {
    this.session = session;
    this.buttplug = buttplug;

    session.onChange(() => this.handleStoreChange());
    buttplug.onAssignmentsChange(() => this.resyncNow());
    buttplug.onDevicesChange(() => this.resyncNow());
    buttplug.onStateChange((state) => {
      if (state === 'connected') {
        this.resyncNow();
      }
    });
  }

  /** Replace all loaded Funscripts for the current track. */
  loadScripts(scripts: Array<{ channel: HapticChannel; funscript: Funscript }>): void {
    this.scripts = scripts.map(({ channel, funscript }) => ({
      channel,
      source: funscript.actions,
      prepared: prepareScript(funscript.actions, this.interpolation),
      moveLockedUntil: 0,
      lastSentPos: null,
    }));
  }

  /** Clear all loaded Funscripts. */
  clearScripts(): void {
    this.scripts = [];
    this.stop();
  }

  /** Applies a playback-time offset in milliseconds, then resynchronizes output. */
  setDelayMs(delayMs: number): void {
    this.delayMs = delayMs;
    this.resyncNow();
  }

  /** Sets how positions between script points are derived, then resynchronizes output. */
  setInterpolation(method: InterpolationMethod): void {
    this.interpolation = method;
    for (const script of this.scripts) script.prepared = prepareScript(script.source, method);
    this.resyncNow();
  }

  /** Sets the continuous-role resampling frequency and restarts the loop if needed. */
  setUpdateFrequencyHz(frequencyHz: number): void {
    const clamped = Math.max(1, frequencyHz);
    this.updateIntervalMs = 1000 / clamped;
    if (this.isPlaying) {
      this.stopLoop();
      this.scheduleTick();
    }
  }

  /** Rebuilds live device state from the current playback time and loaded scripts. */
  resyncNow(): void {
    const effectiveMs = this.getEffectivePlaybackTimeMs();
    this.resetScriptState();

    if (!this.isPlaying) {
      return;
    }

    void this.buttplug.stopAll();
    const now = performance.now();
    for (const script of this.scripts) {
      this.updateScript(script, effectiveMs, now, true);
    }
  }

  /** Mirrors the active player's transport state; seeking invalidates pending moves. */
  private handleStoreChange(): void {
    const { paused, seeking } = this.session.activeStore.state;
    if (seeking) this.resetScriptState();
    if (paused && this.isPlaying) this.pause();
    else if (!paused && !this.isPlaying) this.start();
  }

  private start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    void this.buttplug.stopAll();
    this.tick();
  }

  private pause(): void {
    this.isPlaying = false;
    this.stopLoop();
    void this.buttplug.stopAll();
  }

  private stop(): void {
    this.isPlaying = false;
    this.stopLoop();
    this.resetScriptState();
    void this.buttplug.stopAll();
  }

  /** Clear per-script move gating so the next tick issues a fresh command immediately. */
  private resetScriptState(): void {
    for (const script of this.scripts) {
      script.moveLockedUntil = 0;
      script.lastSentPos = null;
    }
  }

  private tick(): void {
    if (!this.isPlaying) return;

    const nowMs = this.getEffectivePlaybackTimeMs();
    const now = performance.now();

    for (const script of this.scripts) {
      this.updateScript(script, nowMs, now, false);
    }

    this.scheduleTick();
  }

  private scheduleTick(): void {
    this.stopLoop();
    this.timerHandle = window.setTimeout(() => {
      this.timerHandle = null;
      this.tick();
    }, this.updateIntervalMs);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    if (this.timerHandle !== null) {
      window.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private getEffectivePlaybackTimeMs(): number {
    const { currentTime, duration } = this.session.activeStore.state;
    const durationMs = Math.max(0, (duration || 0) * 1000);
    return Math.max(0, Math.min(currentTime * 1000 + this.delayMs, durationMs));
  }

  /** Drive every actuator assigned to this script's channel, in its native style. */
  private updateScript(script: LoadedScript, nowMs: number, now: number, force: boolean): void {
    if (!this.buttplug.hasFeaturesFor(script.channel)) return;

    // Outside the scripted range this resolves to 0, actively forcing the device off
    // instead of holding onto whatever was last (possibly only partially) sent.
    const pos = positionAt(script.prepared, nowMs);
    this.buttplug.sendContinuous(script.channel, pos === null ? 0 : pos / 100);

    if (this.buttplug.hasLinearFor(script.channel)) {
      this.updateStroker(script, nowMs, now, force);
    }
  }

  /** Edge-triggered linear (stroker) moves, rate-limited to the toy's actual travel time. */
  private updateStroker(script: LoadedScript, nowMs: number, now: number, force: boolean): void {
    if (!force && now < script.moveLockedUntil) return;

    const target = this.nextStrokerWaypoint(script.prepared, nowMs);
    if (!target) return;
    if (!force && script.lastSentPos === target.pos) return;

    this.buttplug.sendLinear(script.channel, target.pos, target.durationMs);
    script.lastSentPos = target.pos;
    script.moveLockedUntil = now + target.durationMs;
  }

  /**
   * Next move for a linear device. Without interpolation it jumps to the point just
   * reached; otherwise it travels to the upcoming point (pchip degrades to linear).
   */
  private nextStrokerWaypoint(
    { actions, method }: PreparedScript,
    atMs: number,
  ): { pos: number; durationMs: number } | null {
    if (actions.length === 0 || atMs < actions[0].at) return null;
    const idx = bracketIndex(actions, atMs);

    if (method === 'none') {
      if (atMs > actions[actions.length - 1].at + STEP_MOVE_MS) return null;
      return { pos: actions[idx].pos / 100, durationMs: STEP_MOVE_MS };
    }

    const next = actions[idx + 1];
    if (!next) return null;
    return { pos: next.pos / 100, durationMs: Math.max(1, next.at - atMs) };
  }
}
