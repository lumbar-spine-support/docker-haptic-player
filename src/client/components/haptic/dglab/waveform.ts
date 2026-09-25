/** Pulse frame helpers for the Coyote waveform. */

/** A V3 pulse frame is four frequency bytes followed by four intensity bytes. */
const STEPS_PER_FRAME = 4;

/** Each sub-step of a frame covers 25 ms, so a whole frame covers ~100 ms. */
export const FRAME_DURATION_MS = 100;

export const DEFAULT_PULSE_FREQUENCY = 10;
export const MIN_PULSE_FREQUENCY = 1;
export const MAX_PULSE_FREQUENCY = 100;

/** Highest amplitude a pulse sub-step can carry. */
const MAX_AMPLITUDE = 100;

function byte(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

export function clampFrequency(frequency: number): number {
  if (!Number.isFinite(frequency)) return DEFAULT_PULSE_FREQUENCY;
  return Math.max(MIN_PULSE_FREQUENCY, Math.min(MAX_PULSE_FREQUENCY, Math.round(frequency)));
}

/**
 * A flat carrier frame at full amplitude.
 *
 * Every waveform DG-Lab ships uses one amplitude for the whole frame, so the
 * per-sub-step modulation the format nominally allows is left alone: the script
 * drives channel strength instead.
 */
export function flatFrame(frequency: number, amplitude = MAX_AMPLITUDE): string {
  return byte(clampFrequency(frequency)).repeat(STEPS_PER_FRAME) + byte(amplitude).repeat(STEPS_PER_FRAME);
}

/** `count` identical carrier frames, covering `count * FRAME_DURATION_MS`. */
export function carrierFrames(frequency: number, count: number): string[] {
  return new Array(Math.max(1, count)).fill(flatFrame(frequency));
}
