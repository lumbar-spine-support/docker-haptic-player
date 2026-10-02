import { clamp01 } from '../backend';
import { FRAME_DURATION_MS, STEPS_PER_FRAME, STEP_DURATION_MS, encodeFrame, positionStep } from './waveform';

/**
 * How long a strength task stays alive. Longer than the refresh interval so output
 * never gaps, short enough to act as a dead-man's switch when the tab or the
 * network dies.
 */
export const STRENGTH_DURATION_MS = 300;

/**
 * Strength resend interval. `FunscriptSync` ticks far faster than this, but the
 * device only consumes one tick per ~100 ms, so sending more often just floods
 * the relay.
 */
export const STRENGTH_INTERVAL_MS = 100;

/** Frames per look-ahead batch and how often a batch replaces the queue; the overlap absorbs relay jitter. */
export const LOOKAHEAD_FRAME_COUNT = 5;
export const LOOKAHEAD_INTERVAL_MS = 200;
export const LOOKAHEAD_MS = LOOKAHEAD_FRAME_COUNT * FRAME_DURATION_MS;

/** Position 0–1 at `offsetMs` from now; null where the script has no points. */
export type PositionSampler = (offsetMs: number) => number | null;

export interface PulseSettings {
    /** Pulse rate in Hz. */
    frequency: number;
    /** Relative pulse width, 0–100. */
    width: number;
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

/** Pulse frames for the next `LOOKAHEAD_MS`: each 25 ms step's width follows the position at that time. */
export function lookaheadFrames(sample: PositionSampler, pulse: PulseSettings): string[] {
    return Array.from({ length: LOOKAHEAD_FRAME_COUNT }, (_, f) => encodeFrame(
        Array.from({ length: STEPS_PER_FRAME }, (_, s) =>
            positionStep(sample((f * STEPS_PER_FRAME + s) * STEP_DURATION_MS) ?? 0, pulse.frequency, pulse.width)),
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
    private lastBatchAt = -Infinity;

    /** Strength follows the script and is refreshed before its dead-man's timer runs out. */
    strength(now: number, value: number): StrengthCommand | null {
        const elapsed = now - this.lastStrengthAt;
        const unchanged = this.lastValue === value;
        if (unchanged && elapsed < STRENGTH_DURATION_MS / 2) return null;
        if (!unchanged && elapsed < STRENGTH_INTERVAL_MS) return null;

        this.lastValue = value;
        this.lastStrengthAt = now;
        return { kind: 'strength', value, durationMs: STRENGTH_DURATION_MS };
    }

    /** A look-ahead batch; sent with `im: true`, so it replaces the queued frames. */
    pulses(now: number, sample: PositionSampler, pulse: PulseSettings): PulseCommand | null {
        if (now - this.lastBatchAt < LOOKAHEAD_INTERVAL_MS) return null;
        this.lastBatchAt = now;
        const frames = lookaheadFrames(sample, pulse);
        return { kind: 'pulse', frames, durationMs: frames.length * FRAME_DURATION_MS };
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
            this.lastBatchAt = -Infinity;
            return commands;
        }
        const batch = this.pulses(now, sample, pulse);
        if (batch) commands.push(batch);
        return commands;
    }
}
