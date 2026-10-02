import { positionAt, type PreparedScript } from '../../src/shared/interpolation';
import {
    CoyoteChannelScheduler,
    mapIntensity,
    type CoyoteCommand,
    type PulseSettings,
} from '../../src/client/components/haptic/dglab/channelScheduler';
import {
    FRAME_DURATION_MS,
    STEPS_PER_FRAME,
    STEP_DURATION_MS,
    encodeFrame,
    pulsePeriodMs,
    type PulseStep,
} from '../../src/client/components/haptic/dglab/waveform';

export interface StrategyContext {
    script: PreparedScript;
    /** Device strength slider, 0–1. */
    strength: number;
    /** `intensityMax` the app reports. */
    ceiling: number;
    pulse: PulseSettings;
    /** Expected relay + app delay; look-ahead strategies may compensate for it. */
    latencyMs: number;
}

/** Called once per sync tick, like `CoyoteBackend.sendContinuous`. */
export type TickHandler = (now: number) => CoyoteCommand[];

export interface EstimStrategy {
    id: string;
    label: string;
    description: string;
    create(ctx: StrategyContext): TickHandler;
}

/** Position 0–1 the way `FunscriptSync` reads it: outside the script is 0. */
function position01(script: PreparedScript, at: number): number {
    return (positionAt(script, at) ?? 0) / 100;
}

const strengthEnvelope: EstimStrategy = {
    id: 'strength',
    label: 'Strength envelope (HAPPY today)',
    description: 'The production path: position drives SetTempIntensity through CoyoteChannelScheduler, a flat carrier keeps pulses queued.',
    create(ctx) {
        const scheduler = new CoyoteChannelScheduler();
        return (now) => scheduler.update(now, mapIntensity(position01(ctx.script, now), ctx.strength, ctx.ceiling), ctx.pulse);
    },
};

const LOOKAHEAD_FRAMES = 5;
const LOOKAHEAD_INTERVAL_MS = 200;

const widthModulation: EstimStrategy = {
    id: 'width',
    label: 'Width modulation with look-ahead (experimental)',
    description: 'Strength is held at slider × ceiling while the script runs; position drives the pulse width of every 25 ms step, '
        + `sampled ahead by the latency. ${LOOKAHEAD_FRAMES} frames every ${LOOKAHEAD_INTERVAL_MS} ms, each batch replacing the last.`,
    create(ctx) {
        const scheduler = new CoyoteChannelScheduler();
        const periodMs = pulsePeriodMs(ctx.pulse.frequency);
        let lastBatchAt = -Infinity;
        return (now) => {
            const level = positionAt(ctx.script, now) === null ? 0 : mapIntensity(1, ctx.strength, ctx.ceiling);
            const commands: CoyoteCommand[] = [];
            const strength = scheduler.strength(now, level);
            if (strength) commands.push(strength);
            if (level > 0 && now - lastBatchAt >= LOOKAHEAD_INTERVAL_MS) {
                lastBatchAt = now;
                const start = now + ctx.latencyMs;
                const frames = Array.from({ length: LOOKAHEAD_FRAMES }, (_, f) => encodeFrame(
                    Array.from({ length: STEPS_PER_FRAME }, (_, s): PulseStep => ({
                        periodMs,
                        width: Math.round(position01(ctx.script, start + f * FRAME_DURATION_MS + s * STEP_DURATION_MS) * ctx.pulse.width),
                    })),
                ));
                commands.push({ kind: 'pulse', frames, durationMs: frames.length * FRAME_DURATION_MS });
            }
            return commands;
        };
    },
};

export const STRATEGIES: readonly EstimStrategy[] = [strengthEnvelope, widthModulation];
