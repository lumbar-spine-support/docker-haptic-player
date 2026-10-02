import type { FunscriptAction } from './types';

/** How positions between two Funscript actions are derived, shared by haptic output and the timeline. */
export const INTERPOLATION_METHODS = ['none', 'linear', 'pchip'] as const;

export type InterpolationMethod = typeof INTERPOLATION_METHODS[number];

export const DEFAULT_INTERPOLATION_METHOD: InterpolationMethod = 'pchip';

export function isInterpolationMethod(value: unknown): value is InterpolationMethod {
    return typeof value === 'string' && (INTERPOLATION_METHODS as readonly string[]).includes(value);
}

/**
 * A Funscript with its interpolating curve precomputed. Segment `k` runs from
 * `actions[k]` to `actions[k + 1]` and is the cubic
 * `pos(s) = c0 + c1·s + c2·s² + c3·s³` with `s = ms - actions[k].at`.
 */
export interface PreparedScript {
    readonly method: InterpolationMethod;
    /** Sorted by `at`. */
    readonly actions: readonly FunscriptAction[];
    /** Four coefficients per segment: c0, c1, c2, c3 (c1–c3 per millisecond powers). */
    readonly coeffs: Float64Array;
    /** Average |Δpos| per second of each segment; the speed shown for `none`, whose derivative is degenerate. */
    readonly avgSpeed: Float64Array;
}

/** Sort the actions and precompute the curve of every segment for `method`. */
export function prepareScript(actions: readonly FunscriptAction[], method: InterpolationMethod): PreparedScript {
    const sorted = [...actions].sort((a, b) => a.at - b.at);
    const segments = Math.max(0, sorted.length - 1);
    const coeffs = new Float64Array(segments * 4);
    const avgSpeed = new Float64Array(segments);
    const slopes = method === 'pchip' ? pchipSlopes(sorted) : null;

    for (let k = 0; k < segments; k++) {
        const a = sorted[k]!;
        const b = sorted[k + 1]!;
        const h = b.at - a.at;
        const o = k * 4;
        if (h <= 0) {
            coeffs[o] = b.pos;
            continue;
        }
        const delta = (b.pos - a.pos) / h;
        avgSpeed[k] = Math.abs(delta) * 1000;
        coeffs[o] = a.pos;
        if (method === 'linear') {
            coeffs[o + 1] = delta;
        } else if (slopes) {
            const da = slopes[k]!;
            const db = slopes[k + 1]!;
            coeffs[o + 1] = da;
            coeffs[o + 2] = (3 * delta - 2 * da - db) / h;
            coeffs[o + 3] = (da + db - 2 * delta) / (h * h);
        }
    }
    return { method, actions: sorted, coeffs, avgSpeed };
}

/** Fritsch–Carlson slopes (pos per ms) at each action, which keep the cubic free of overshoot. */
function pchipSlopes(actions: readonly FunscriptAction[]): Float64Array {
    const n = actions.length;
    const slopes = new Float64Array(n);
    if (n < 2) return slopes;

    const h = new Float64Array(n - 1);
    const delta = new Float64Array(n - 1);
    for (let k = 0; k < n - 1; k++) {
        h[k] = actions[k + 1]!.at - actions[k]!.at;
        delta[k] = h[k]! > 0 ? (actions[k + 1]!.pos - actions[k]!.pos) / h[k]! : 0;
    }

    for (let k = 1; k < n - 1; k++) {
        const d0 = delta[k - 1]!;
        const d1 = delta[k]!;
        if (d0 * d1 <= 0 || h[k - 1]! <= 0 || h[k]! <= 0) continue;
        const w1 = 2 * h[k]! + h[k - 1]!;
        const w2 = h[k]! + 2 * h[k - 1]!;
        slopes[k] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
    slopes[0] = endSlope(h[0]!, h[1] ?? 0, delta[0]!, delta[1] ?? delta[0]!);
    slopes[n - 1] = endSlope(h[n - 2]!, h[n - 3] ?? 0, delta[n - 2]!, delta[n - 3] ?? delta[n - 2]!);
    return slopes;
}

/** Shape-preserving three-point end slope for the outermost actions. */
function endSlope(h0: number, h1: number, d0: number, d1: number): number {
    if (h0 + h1 <= 0) return d0;
    const d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(d) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(d) > Math.abs(3 * d0)) return 3 * d0;
    return d;
}

/** Index of the last action with `at <= atMs`, or 0 when `atMs` precedes all actions. */
export function bracketIndex(actions: readonly FunscriptAction[], atMs: number): number {
    let lo = 0;
    let hi = actions.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (actions[mid]!.at <= atMs) lo = mid; else hi = mid - 1;
    }
    return lo;
}

/** Position (0–100) at `atMs` on segment `k`; the single source of truth for interpolated values. */
export function segmentPosition(script: PreparedScript, k: number, atMs: number): number {
    const o = k * 4;
    const c = script.coeffs;
    const s = atMs - script.actions[k]!.at;
    return Math.min(100, Math.max(0, c[o]! + s * (c[o + 1]! + s * (c[o + 2]! + s * c[o + 3]!))));
}

/** |d pos / dt| in position units per second at `atMs` on segment `k`. */
export function segmentSpeed(script: PreparedScript, k: number, atMs: number): number {
    if (script.method === 'none') return script.avgSpeed[k]!;
    const o = k * 4;
    const c = script.coeffs;
    const s = atMs - script.actions[k]!.at;
    return Math.abs(c[o + 1]! + s * (2 * c[o + 2]! + s * 3 * c[o + 3]!)) * 1000;
}

/** Position (0–100) at `atMs`, or null outside the scripted range. */
export function positionAt(script: PreparedScript, atMs: number): number | null {
    const { actions } = script;
    if (actions.length === 0) return null;
    if (atMs < actions[0]!.at || atMs > actions[actions.length - 1]!.at) return null;
    const k = bracketIndex(actions, atMs);
    if (k >= actions.length - 1) return actions[k]!.pos;
    return segmentPosition(script, k, atMs);
}
