import type { FunscriptAction } from '../../../../shared/types';

/** Index of the first action with `at >= ms` (actions must be sorted by `at`). */
export function lowerBound(actions: readonly FunscriptAction[], ms: number): number {
    let lo = 0;
    let hi = actions.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (actions[mid]!.at < ms) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Polyline vertices of a sample-and-hold plot over [startMs, endMs], as
 * (ms, pos) pairs. Each position is held until the next action; the line only
 * covers the span between the first and last action.
 */
export function stepPoints(
    actions: readonly FunscriptAction[],
    startMs: number,
    endMs: number,
): Array<[number, number]> {
    if (actions.length === 0 || endMs <= startMs) return [];
    const first = actions[0]!;
    const last = actions[actions.length - 1]!;
    const from = Math.max(startMs, first.at);
    const to = Math.min(endMs, last.at);
    if (from > to) return [];

    let i = lowerBound(actions, from);
    if (i >= actions.length || actions[i]!.at > from) i -= 1;
    let pos = actions[i]!.pos;
    const points: Array<[number, number]> = [[from, pos]];

    for (i += 1; i < actions.length && actions[i]!.at <= to; i++) {
        const a = actions[i]!;
        points.push([a.at, pos], [a.at, a.pos]);
        pos = a.pos;
    }
    points.push([to, pos]);
    return points;
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
