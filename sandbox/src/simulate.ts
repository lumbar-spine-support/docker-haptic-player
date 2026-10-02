import { positionAt } from '../../src/shared/interpolation';
import { clamp01 } from '../../src/client/components/haptic/backend';
import type { CoyoteCommand } from '../../src/client/components/haptic/dglab/channelScheduler';
import { effectiveLevel, type AppPlayback } from './appModel';
import type { EstimStrategy, StrategyContext } from './strategies';

export interface SimulationInput extends StrategyContext {
    strategy: EstimStrategy;
    t0: number;
    t1: number;
    /** `FunscriptSync` update rate. */
    tickHz: number;
}

export interface TimedCommand {
    at: number;
    command: CoyoteCommand;
}

export interface SyncTick {
    at: number;
    position: number | null;
}

export interface SimulationResult {
    ticks: SyncTick[];
    commands: TimedCommand[];
}

/** Replays `FunscriptSync`'s timer loop against one channel, without a socket. */
export function runSyncLoop(input: SimulationInput): SimulationResult {
    const handle = input.strategy.create(input);
    const interval = 1000 / input.tickHz;
    const ticks: SyncTick[] = [];
    const commands: TimedCommand[] = [];
    for (let i = 0; ; i++) {
        const at = input.t0 + i * interval;
        if (at >= input.t1) break;
        ticks.push({ at, position: positionAt(input.script, at) });
        for (const command of handle(at)) commands.push({ at, command });
    }
    return { ticks, commands };
}

/** Unrounded, unthrottled, zero-latency target: what a perfect device would output. */
export function idealLevel(ctx: StrategyContext, at: number): number {
    return ((positionAt(ctx.script, at) ?? 0) / 100) * clamp01(ctx.strength) * Math.max(0, ctx.ceiling);
}

export interface Summary {
    strengthPerSecond: number;
    pulsePerSecond: number;
    rmsError: number;
}

export function summarize(input: SimulationInput, sim: SimulationResult, app: AppPlayback): Summary {
    const seconds = Math.max(1e-9, (input.t1 - input.t0) / 1000);
    const count = (kind: CoyoteCommand['kind']) => sim.commands.filter((c) => c.command.kind === kind).length;
    let sum = 0;
    for (const step of app.steps) {
        const error = effectiveLevel(step, input.pulse.width) - idealLevel(input, step.at);
        sum += error * error;
    }
    return {
        strengthPerSecond: count('strength') / seconds,
        pulsePerSecond: count('pulse') / seconds,
        rmsError: Math.sqrt(sum / Math.max(1, app.steps.length)),
    };
}

/** Run-length summary such as `0A0A0A0A64646464 ×10`. */
export function describeFrames(frames: readonly string[]): string {
    const runs: string[] = [];
    for (let i = 0; i < frames.length;) {
        let j = i;
        while (j < frames.length && frames[j] === frames[i]) j++;
        runs.push(j - i > 1 ? `${frames[i]} ×${j - i}` : frames[i]!);
        i = j;
    }
    return runs.join(' ');
}
