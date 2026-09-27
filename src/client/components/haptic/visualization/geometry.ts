import { bracketIndex, positionAt, segmentPosition, segmentSpeed, type PreparedScript } from '../../../../shared/interpolation';

export interface CurvePoint {
    ms: number;
    pos: number;
    /** |d pos / dt| in position units per second of the segment ending at this point. */
    speed: number;
}

/**
 * Polyline of the precomputed curve over [startMs, endMs], clipped to the
 * scripted range. PCHIP segments are sampled every `resolutionMs`.
 */
export function curvePoints(
    script: PreparedScript,
    startMs: number,
    endMs: number,
    resolutionMs: number,
): CurvePoint[] {
    const { actions, method } = script;
    if (actions.length === 0 || endMs <= startMs) return [];
    const from = Math.max(startMs, actions[0]!.at);
    const to = Math.min(endMs, actions[actions.length - 1]!.at);
    if (from > to) return [];

    const points: CurvePoint[] = [{ ms: from, pos: positionAt(script, from)!, speed: 0 }];
    for (let k = bracketIndex(actions, from); k < actions.length - 1 && actions[k]!.at < to; k++) {
        const a = actions[k]!;
        const b = actions[k + 1]!;
        if (b.at <= a.at) {
            points.push({ ms: b.at, pos: b.pos, speed: 0 });
            continue;
        }
        const segStart = Math.max(a.at, from);
        const segEnd = Math.min(b.at, to);

        if (method === 'none') {
            const speed = segmentSpeed(script, k, segEnd);
            points.push({ ms: segEnd, pos: segmentPosition(script, k, segEnd), speed });
            if (segEnd === b.at) points.push({ ms: b.at, pos: b.pos, speed });
        } else if (method === 'pchip') {
            const n = Math.max(1, Math.ceil((segEnd - segStart) / Math.max(1, resolutionMs)));
            const stepMs = (segEnd - segStart) / n;
            for (let i = 1; i <= n; i++) {
                const ms = segStart + stepMs * i;
                points.push({
                    ms,
                    pos: segmentPosition(script, k, ms),
                    speed: segmentSpeed(script, k, ms - stepMs / 2),
                });
            }
        } else {
            points.push({ ms: segEnd, pos: segmentPosition(script, k, segEnd), speed: segmentSpeed(script, k, segEnd) });
        }
    }
    return points;
}

/** Speed (position units per second) at which the heat scale saturates. */
export const HEAT_MAX_SPEED = 500;
const HEAT_BUCKETS = 32;

/** Heat colour for a speed, quantised so neighbouring segments can share one stroke. */
export function heatColor(speed: number): string {
    const t = Math.min(1, Math.max(0, speed / HEAT_MAX_SPEED));
    const bucket = Math.round(t * (HEAT_BUCKETS - 1)) / (HEAT_BUCKETS - 1);
    return `hsl(${Math.round(240 * (1 - bucket))}, 90%, 55%)`;
}

/** Estimates media time between coarse store updates using the wall clock. */
export class MediaClock {
    private time = 0;
    private stamp = 0;
    private rate = 1;
    private paused = true;

    constructor(private readonly now: () => number = () => performance.now()) { }

    sync(time: number, paused: boolean, rate: number): void {
        // Only re-anchor when the reported time moved, so repeated identical updates don't stall the estimate.
        if (time !== this.time || paused !== this.paused || rate !== this.rate) {
            this.time = time;
            this.stamp = this.now();
        }
        this.paused = paused;
        this.rate = rate;
    }

    read(duration: number): number {
        const elapsed = this.paused ? 0 : ((this.now() - this.stamp) / 1000) * this.rate;
        return Math.max(0, Math.min(duration, this.time + elapsed));
    }
}
