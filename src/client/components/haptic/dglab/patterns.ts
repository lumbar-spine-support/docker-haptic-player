import { positionAt, prepareScript, type InterpolationMethod, type PreparedScript } from '../../../../shared/interpolation';

/** A looping test pattern, written as one funscript cycle that starts and ends at the same position. */
export interface WaveformPattern {
  id: string;
  label: string;
  method: InterpolationMethod;
  /** `[at, pos]` pairs; the last `at` is the cycle length. */
  points: readonly (readonly [number, number])[];
}

export const WAVEFORM_PATTERNS: readonly WaveformPattern[] = [
  { id: 'constant', label: 'Constant', method: 'linear', points: [[0, 100], [1000, 100]] },
  { id: 'wave', label: 'Wave (2 s)', method: 'pchip', points: [[0, 0], [1000, 100], [2000, 0]] },
  { id: 'pulse', label: 'On / off (1 s)', method: 'none', points: [[0, 100], [500, 0], [1000, 100]] },
  { id: 'ramp', label: 'Ramp up (4 s)', method: 'linear', points: [[0, 0], [3900, 100], [4000, 0]] },
  { id: 'strokes', label: 'Fast strokes', method: 'linear', points: [[0, 20], [150, 100], [300, 20]] },
  { id: 'heartbeat', label: 'Heartbeat', method: 'pchip', points: [[0, 0], [80, 100], [180, 15], [280, 80], [400, 0], [1000, 0]] },
  { id: 'climb', label: 'Climb (steps)', method: 'none', points: [[0, 25], [1000, 50], [2000, 75], [3000, 100], [4000, 25]] },
];

export const DEFAULT_PATTERN_ID = 'wave';

/** A pattern's cycle length in ms. */
export function patternCycleMs(pattern: WaveformPattern): number {
  return pattern.points[pattern.points.length - 1]![0];
}

/** Position 0–1 at any time, looping the cycle forever. */
export function patternSampler(pattern: WaveformPattern): (atMs: number) => number {
  const script: PreparedScript = prepareScript(pattern.points.map(([at, pos]) => ({ at, pos })), pattern.method);
  const cycle = patternCycleMs(pattern);
  return (atMs) => (positionAt(script, ((atMs % cycle) + cycle) % cycle) ?? 0) / 100;
}
