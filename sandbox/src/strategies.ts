import { positionAt, type PreparedScript } from '../../src/shared/interpolation';
import {
    CoyoteChannelScheduler,
    mapIntensity,
    type CoyoteCommand,
    type PulseSettings,
} from '../../src/client/components/haptic/dglab/channelScheduler';

export interface StrategyContext {
    script: PreparedScript;
    /** Device strength slider, 0–1. */
    strength: number;
    /** `intensityMax` the app reports. */
    ceiling: number;
    pulse: PulseSettings;
    /** Relay + app delay the app model applies; the app compensates through its delay slider. */
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

const widthModulation: EstimStrategy = {
    id: 'width',
    label: 'Width modulation with look-ahead (HAPPY)',
    description: 'The production path: strength is held at slider × ceiling with a dead-man timeout; the script drives the pulse width '
        + 'of every 25 ms step through CoyoteChannelScheduler, streamed as contiguous frames appended to the queue.',
    create(ctx) {
        const scheduler = new CoyoteChannelScheduler();
        const level = mapIntensity(1, ctx.strength, ctx.ceiling);
        return (now) => scheduler.update(now, level, (offsetMs) => {
            const pos = positionAt(ctx.script, now + offsetMs);
            return pos === null ? null : pos / 100;
        }, ctx.pulse);
    },
};

export const STRATEGIES: readonly EstimStrategy[] = [widthModulation];
