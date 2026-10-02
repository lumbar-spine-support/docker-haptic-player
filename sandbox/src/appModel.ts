import type { CoyoteCommand } from '../../src/client/components/haptic/dglab/channelScheduler';
import {
    FRAME_DURATION_MS,
    STEPS_PER_FRAME,
    STEP_DURATION_MS,
    decodeFrame,
    type DecodedStep,
} from '../../src/client/components/haptic/dglab/waveform';
import type { TimedCommand } from './simulate';

/**
 * A model of the DG-Lab app, not its code: every 100 ms it forwards the current
 * strength and the next queued frame to the Coyote. `im: true` replaces both.
 */
const APP_TICK_MS = FRAME_DURATION_MS;

export interface AppFrame {
    at: number;
    strength: number;
    frame: string | null;
}

/** One 25 ms sub-step as played; `periodMs` is null while no frame plays. */
export interface StepSample extends DecodedStep {
    at: number;
    strength: number;
}

export interface Pulse {
    at: number;
    /** Strength × width / 100, a rough stand-in for the charge of one pulse. */
    amplitude: number;
}

export interface AppPlayback {
    frames: AppFrame[];
    steps: StepSample[];
    pulses: Pulse[];
}

type Timed<K extends CoyoteCommand['kind']> = TimedCommand & { command: Extract<CoyoteCommand, { kind: K }> };

export function playOnApp(commands: readonly TimedCommand[], t0: number, t1: number, latencyMs: number): AppPlayback {
    const strengths = commands.filter((c): c is Timed<'strength'> => c.command.kind === 'strength');
    const batches = commands.filter((c): c is Timed<'pulse'> => c.command.kind === 'pulse');
    const frames: AppFrame[] = [];
    const steps: StepSample[] = [];
    let si = 0;
    let bi = 0;
    let strength = { value: 0, until: -Infinity };
    let batch: { firstTick: number; frames: string[]; until: number } | null = null;

    for (let at = t0; at < t1; at += APP_TICK_MS) {
        while (si < strengths.length && strengths[si]!.at + latencyMs <= at) {
            const { at: sent, command } = strengths[si++]!;
            strength = { value: command.value, until: sent + latencyMs + command.durationMs };
        }
        while (bi < batches.length && batches[bi]!.at + latencyMs <= at) {
            const { at: sent, command } = batches[bi++]!;
            batch = { firstTick: at, frames: command.frames, until: sent + latencyMs + command.durationMs };
        }
        const value = at < strength.until ? strength.value : 0;
        const index = batch ? Math.round((at - batch.firstTick) / APP_TICK_MS) : -1;
        const frame = batch && at < batch.until ? batch.frames[index] ?? null : null;
        frames.push({ at, strength: value, frame });

        const decoded = frame ? decodeFrame(frame) : null;
        for (let j = 0; j < STEPS_PER_FRAME; j++) {
            steps.push({
                at: at + j * STEP_DURATION_MS,
                strength: value,
                periodMs: decoded?.[j]?.periodMs ?? null,
                width: decoded?.[j]?.width ?? 0,
            });
        }
    }
    return { frames, steps, pulses: pulseTrain(steps) };
}

/** Pulses keep their spacing across steps; how the device really handles periods over 25 ms is undocumented. */
function pulseTrain(steps: readonly StepSample[]): Pulse[] {
    const pulses: Pulse[] = [];
    let next = -Infinity;
    for (const step of steps) {
        if (step.periodMs === null || step.strength <= 0 || step.width <= 0) {
            next = -Infinity;
            continue;
        }
        if (next < step.at) next = step.at;
        for (const end = step.at + STEP_DURATION_MS; next < end; next += step.periodMs) {
            pulses.push({ at: next, amplitude: step.strength * step.width / 100 });
        }
    }
    return pulses;
}

/** Output in strength units, normalised so the configured pulse width counts as full. */
export function effectiveLevel(step: StepSample, pulseWidth: number): number {
    if (step.periodMs === null || pulseWidth <= 0) return 0;
    return step.strength * step.width / pulseWidth;
}
