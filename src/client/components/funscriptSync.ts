import type { Funscript, FunscriptAction } from '../../shared/types';
import type { HapticChannel } from '../../shared/haptics';
import type { HapticBackend } from './haptic/backend';
import type { PlaybackSession } from './player';

interface LoadedScript {
  channel: HapticChannel;
  actions: FunscriptAction[];
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
      actions: [...funscript.actions].sort((a, b) => a.at - b.at),
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
    const pos = this.interpolatedPosition(script.actions, nowMs) ?? 0;
    this.buttplug.sendContinuous(script.channel, pos);

    if (this.buttplug.hasLinearFor(script.channel)) {
      this.updateStroker(script, nowMs, now, force);
    }
  }

  /** Edge-triggered linear (stroker) moves, rate-limited to the toy's actual travel time. */
  private updateStroker(script: LoadedScript, nowMs: number, now: number, force: boolean): void {
    if (!force && now < script.moveLockedUntil) return;

    const target = this.nextStrokerWaypoint(script.actions, nowMs);
    if (!target) return;
    if (!force && script.lastSentPos === target.pos) return;

    this.buttplug.sendLinear(script.channel, target.pos, target.durationMs);
    script.lastSentPos = target.pos;
    script.moveLockedUntil = now + target.durationMs;
  }

  /** Linearly interpolate the 0–1 intensity at `atMs`; null when outside the scripted range. */
  private interpolatedPosition(actions: FunscriptAction[], atMs: number): number | null {
    if (actions.length === 0) return null;
    if (atMs < actions[0].at || atMs > actions[actions.length - 1].at) return null;

    const idx = this.findBracketIndex(actions, atMs);
    const prev = actions[idx];
    const next = actions[Math.min(idx + 1, actions.length - 1)];
    if (next.at === prev.at) return prev.pos / 100;

    const t = (atMs - prev.at) / (next.at - prev.at);
    return (prev.pos + (next.pos - prev.pos) * t) / 100;
  }

  /** Find the next waypoint for a linear device: its target position and time to reach it. */
  private nextStrokerWaypoint(
    actions: FunscriptAction[],
    atMs: number,
  ): { pos: number; durationMs: number } | null {
    if (actions.length < 2) return null;
    if (atMs < actions[0].at || atMs >= actions[actions.length - 1].at) return null;

    const idx = this.findBracketIndex(actions, atMs);
    const next = actions[idx + 1];
    if (!next) return null;

    return { pos: next.pos / 100, durationMs: Math.max(1, next.at - atMs) };
  }

  /** Binary search for the last action index with `at <= atMs`. */
  private findBracketIndex(actions: FunscriptAction[], atMs: number): number {
    let lo = 0;
    let hi = actions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (actions[mid].at <= atMs) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
}
