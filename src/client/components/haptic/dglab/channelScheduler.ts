import { clamp01 } from '../backend';
import { FRAME_DURATION_MS, carrierFrames } from './waveform';

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

/** Carrier batch size and how often it is refreshed. */
export const CARRIER_FRAME_COUNT = 10;
export const CARRIER_INTERVAL_MS = 800;

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

/**
 * Throttles one channel's target strength into relay commands, without any I/O,
 * so the same timing can be replayed offline.
 */
export class CoyoteChannelScheduler {
    private lastValue: number | null = null;
    private lastStrengthAt = -Infinity;
    private lastCarrierAt = -Infinity;

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

    /**
     * Keep a flat carrier queued.
     *
     * Strength only scales pulses the device is already emitting, so without a
     * carrier a non-zero strength produces nothing. Batches are sent with `im: true`
     * so they replace rather than stack; restarting a constant carrier is inaudible.
     */
    carrier(now: number, pulse: PulseSettings): PulseCommand | null {
        if (now - this.lastCarrierAt < CARRIER_INTERVAL_MS) return null;
        this.lastCarrierAt = now;
        const frames = carrierFrames(pulse.frequency, pulse.width, CARRIER_FRAME_COUNT);
        return { kind: 'pulse', frames, durationMs: frames.length * FRAME_DURATION_MS };
    }

    /** Commands for one sync tick: strength, plus a carrier refresh while there is output. */
    update(now: number, value: number, pulse: PulseSettings): CoyoteCommand[] {
        const commands: CoyoteCommand[] = [];
        const strength = this.strength(now, value);
        if (strength) commands.push(strength);
        const carrier = value > 0 ? this.carrier(now, pulse) : null;
        if (carrier) commands.push(carrier);
        return commands;
    }
}
