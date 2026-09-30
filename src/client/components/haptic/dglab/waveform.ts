/** Pulse frame helpers for the Coyote waveform. */

/** A V3 pulse frame is four frequency bytes followed by four intensity bytes. */
const STEPS_PER_FRAME = 4;

/** Each sub-step of a frame covers 25 ms, so a whole frame covers ~100 ms. */
export const FRAME_DURATION_MS = 100;

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

/**
 * A flat carrier frame.
 *
 * Every waveform DG-Lab ships uses one amplitude for the whole frame, so the
 * per-sub-step modulation the format nominally allows is left alone: the script
 * drives channel strength instead.
 */
export function flatFrame(frequency: number, width = DEFAULT_PULSE_WIDTH): string {
  return byte(pulsePeriodMs(frequency)).repeat(STEPS_PER_FRAME) + byte(clampPulseWidth(width)).repeat(STEPS_PER_FRAME);
}

/** `count` identical carrier frames, covering `count * FRAME_DURATION_MS`. */
export function carrierFrames(frequency: number, width: number, count: number): string[] {
  return new Array(Math.max(1, count)).fill(flatFrame(frequency, width));
}
