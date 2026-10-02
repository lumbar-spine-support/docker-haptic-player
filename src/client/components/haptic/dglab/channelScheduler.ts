import { clamp01 } from '../backend';
import { FRAME_DURATION_MS, STEPS_PER_FRAME, STEP_DURATION_MS, encodeFrame, positionStep } from './waveform';

/**
 * How long a strength task stays alive: the dead-man's switch when the tab or the
 * network dies. Each refresh replaces the running task, so refresh sparingly.
 */
export const STRENGTH_DURATION_MS = 1000;

/** Strength resend interval while the value changes; one app tick is ~100 ms. */
export const STRENGTH_INTERVAL_MS = 100;

/**
 * Frames are appended in batches of `BATCH_FRAMES` whenever less than `BUFFER_MS`
 * is queued; each batch is one app task, and task hand-overs are where playback can
 * hiccup, so batches are long. Replacing the queue instead would restart playback
 * at a jitter-dependent point.
 */
export const BUFFER_MS = 500;
export const BATCH_FRAMES = 10;
/** Behind this far, the queue has run dry (e.g. a throttled tab) and is primed again. */
export const UNDERRUN_MS = FRAME_DURATION_MS;
/** The window checked for script points when deciding whether a channel is active. */
export const LOOKAHEAD_MS = 500;

/** Position 0–1 at `offsetMs` from now; null where the script has no points. */
export type PositionSampler = (offsetMs: number) => number | null;

export interface PulseSettings {
    /** Pulse rate in Hz. */
    frequency: number;
}

export interface StrengthCommand {
    kind: 'strength';
    value: number;
    durationMs: number;
}

export interface PulseCommand {
    kind: 'pulse';
    frames: string[];
    durationMs: number;
    /** `im: true`: drop whatever the app has queued and start with these frames. */
    replace: boolean;
}

/** What one channel should send to the relay: `SetTempIntensity` or `AppendPulseData`. */
export type CoyoteCommand = StrengthCommand | PulseCommand;

/**
 * Map a funscript position to an absolute channel strength.
 *
 * Exported as a free function so the mapping can be tested without a socket.
 */
export function mapIntensity(position: number, strength: number, ceiling: number): number {
    return Math.round(clamp01(position) * clamp01(strength) * Math.max(0, ceiling));
}

/** `count` frames starting `startMs` from now: each 25 ms step's width follows the position at that time. */
export function lookaheadFrames(sample: PositionSampler, pulse: PulseSettings, startMs: number, count: number): string[] {
    return Array.from({ length: count }, (_, f) => encodeFrame(
        Array.from({ length: STEPS_PER_FRAME }, (_, s) =>
            positionStep(sample(startMs + (f * STEPS_PER_FRAME + s) * STEP_DURATION_MS) ?? 0, pulse.frequency)),
    ));
}

/**
 * Turns one channel's script into relay commands, without any I/O, so the same
 * timing can be replayed offline.
 *
 * Strength is held at the user's level (and expires as a dead-man's switch); the
 * script drives the pulse width per 25 ms step, four times finer than strength.
 */
export class CoyoteChannelScheduler {
    private lastValue: number | null = null;
    private lastStrengthAt = -Infinity;
    /** Wall time the frames sent so far run out; null while not streaming. */
    private queuedUntil: number | null = null;

    /** Strength is refreshed before its dead-man's timer runs out; switching on or off is never throttled. */
    strength(now: number, value: number): StrengthCommand | null {
        const elapsed = now - this.lastStrengthAt;
        const unchanged = this.lastValue === value;
        const toggled = (this.lastValue ?? 0) === 0 || value === 0;
        if (unchanged && elapsed < STRENGTH_DURATION_MS / 2) return null;
        if (!unchanged && !toggled && elapsed < STRENGTH_INTERVAL_MS) return null;

        this.lastValue = value;
        this.lastStrengthAt = now;
        return { kind: 'strength', value, durationMs: STRENGTH_DURATION_MS };
    }

    /** Appends a batch once the queue runs low, continuing exactly where the last frame ended. */
    pulses(now: number, sample: PositionSampler, pulse: PulseSettings): PulseCommand | null {
        const replace = this.queuedUntil === null || this.queuedUntil < now - UNDERRUN_MS;
        const start = replace ? now : this.queuedUntil!;
        if (start - now >= BUFFER_MS) return null;
        const frames = lookaheadFrames(sample, pulse, start - now, BATCH_FRAMES);
        this.queuedUntil = start + BATCH_FRAMES * FRAME_DURATION_MS;
        return { kind: 'pulse', frames, durationMs: BATCH_FRAMES * FRAME_DURATION_MS, replace };
    }

    /**
     * Commands for one sync tick. `level` is the held strength; it drops to 0 when
     * the script has nothing in the look-ahead window, which also stops the frames.
     */
    update(now: number, level: number, sample: PositionSampler, pulse: PulseSettings): CoyoteCommand[] {
        const active = level > 0 && (sample(0) !== null || sample(LOOKAHEAD_MS) !== null);
        const commands: CoyoteCommand[] = [];
        const strength = this.strength(now, active ? level : 0);
        if (strength) commands.push(strength);
        if (!active) {
            this.queuedUntil = null;
            return commands;
        }
        const batch = this.pulses(now, sample, pulse);
        if (batch) commands.push(batch);
        return commands;
    }
}
