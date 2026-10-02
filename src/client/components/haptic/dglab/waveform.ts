/** Pulse frame helpers for the Coyote waveform. */

/** A V3 pulse frame is four frequency bytes followed by four intensity bytes. */
export const STEPS_PER_FRAME = 4;

/** Each sub-step of a frame covers 25 ms, so a whole frame covers ~100 ms. */
export const FRAME_DURATION_MS = 100;
export const STEP_DURATION_MS = FRAME_DURATION_MS / STEPS_PER_FRAME;

/** Shortest and longest pulse period the period byte can express. */
const MIN_PERIOD_MS = 10;
const MAX_PERIOD_MS = 1000;

/** One 25 ms sub-step of a frame. */
export interface PulseStep {
  periodMs: number;
  /** Relative pulse width, 0–100. */
  width: number;
}

/** A decoded sub-step; `periodMs` is null when the byte is out of range and the device drops the frame. */
export interface DecodedStep {
  periodMs: number | null;
  width: number;
}

/**
 * Pulse rate in Hz. The wire byte is the pulse period in ms (valid 10–240, larger
 * values compressed); 10–100 Hz maps to 10–100 ms, which needs no compression.
 */
export const DEFAULT_PULSE_FREQUENCY = 50;
export const MIN_PULSE_FREQUENCY = 10;
export const MAX_PULSE_FREQUENCY = 100;

/** Relative pulse width, 0–100 on the wire; 0 would emit nothing, so it is not offered. */
export const DEFAULT_PULSE_WIDTH = 100;
export const MIN_PULSE_WIDTH = 10;
export const MAX_PULSE_WIDTH = 100;

function byte(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

export function clampFrequency(frequency: number): number {
  if (!Number.isFinite(frequency)) return DEFAULT_PULSE_FREQUENCY;
  return Math.max(MIN_PULSE_FREQUENCY, Math.min(MAX_PULSE_FREQUENCY, Math.round(frequency)));
}

export function clampPulseWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PULSE_WIDTH;
  return Math.max(MIN_PULSE_WIDTH, Math.min(MAX_PULSE_WIDTH, Math.round(width)));
}

/** Wire value for a pulse rate: the period in ms. */
export function pulsePeriodMs(frequency: number): number {
  return Math.round(1000 / clampFrequency(frequency));
}

/** Period byte: 10–100 ms as is, 101–600 ms and 601–1000 ms compressed into 101–200 and 201–240. */
export function periodByte(periodMs: number): number {
  const ms = Math.max(MIN_PERIOD_MS, Math.min(MAX_PERIOD_MS, Math.round(periodMs)));
  if (ms <= 100) return ms;
  if (ms <= 600) return Math.round((ms - 100) / 5) + 100;
  return Math.round((ms - 600) / 10) + 200;
}

/** Inverse of `periodByte`; null for bytes the device rejects. */
export function periodFromByte(value: number): number | null {
  if (value < MIN_PERIOD_MS || value > 240) return null;
  if (value <= 100) return value;
  if (value <= 200) return (value - 100) * 5 + 100;
  return (value - 200) * 10 + 600;
}

/** A V3 frame from exactly four sub-steps. */
export function encodeFrame(steps: readonly PulseStep[]): string {
  if (steps.length !== STEPS_PER_FRAME) throw new RangeError(`a frame has ${STEPS_PER_FRAME} steps, got ${steps.length}`);
  const periods = steps.map((s) => byte(periodByte(s.periodMs))).join('');
  const widths = steps.map((s) => byte(Math.max(0, Math.min(MAX_PULSE_WIDTH, s.width)))).join('');
  return periods + widths;
}

export function decodeFrame(frame: string): DecodedStep[] {
  if (!/^[0-9a-f]{16}$/i.test(frame)) throw new RangeError(`not a V3 frame: ${frame}`);
  const bytes = frame.match(/../g)!.map((h) => parseInt(h, 16));
  return bytes.slice(0, STEPS_PER_FRAME).map((p, i) => ({
    periodMs: periodFromByte(p),
    width: bytes[STEPS_PER_FRAME + i]!,
  }));
}

/** A script position (0–1) as a sub-step: the pulse width setting is the width at full position. */
export function positionStep(position: number, frequency: number, width: number): PulseStep {
  const clamped = Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : 0;
  return { periodMs: pulsePeriodMs(frequency), width: Math.round(clamped * clampPulseWidth(width)) };
}
