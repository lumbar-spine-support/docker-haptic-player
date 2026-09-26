import type { HapticBackend } from './haptic/backend';

/** Minimum gap (percentage points) enforced between the min and max handles. */
const MIN_GAP = 10;
const RANGE_STEP = 5;

/**
 * Binds the dual-handle Min/Max Position slider that rescales stroker (linear)
 * travel independently of per-device strength.
 */
export class StrokerRangeControls {
  private readonly buttplug: HapticBackend;

  constructor(buttplug: HapticBackend) {
    this.buttplug = buttplug;
  }

  private snapToStep(value: number): number {
    return Math.min(100, Math.max(0, Math.round(value / RANGE_STEP) * RANGE_STEP));
  }

  /**
   * Binds the dual-slider stroker range control, enforcing a visible minimum
   * gap so both handles stay independently selectable.
   */
  init(
    minEl: HTMLInputElement,
    maxEl: HTMLInputElement,
    labelEl: HTMLElement | null,
    initialMin: number,
    initialMax: number,
  ): void {
    minEl.value = String(this.snapToStep(initialMin));
    maxEl.value = String(this.snapToStep(initialMax));
    this.apply(minEl, maxEl, labelEl);

    minEl.addEventListener('input', () => {
      const nextMin = this.snapToStep(Number(minEl.value));
      const maxLimit = Number(maxEl.value) - MIN_GAP;
      minEl.value = String(Math.min(nextMin, Math.max(0, maxLimit)));
      this.apply(minEl, maxEl, labelEl);
    });

    maxEl.addEventListener('input', () => {
      const nextMax = this.snapToStep(Number(maxEl.value));
      const minLimit = Number(minEl.value) + MIN_GAP;
      maxEl.value = String(Math.max(nextMax, Math.min(100, minLimit)));
      this.apply(minEl, maxEl, labelEl);
    });
  }

  private apply(
    minEl: HTMLInputElement,
    maxEl: HTMLInputElement,
    labelEl: HTMLElement | null,
  ): void {
    const min = this.snapToStep(Number(minEl.value));
    const max = this.snapToStep(Number(maxEl.value));
    minEl.value = String(min);
    maxEl.value = String(max);
    this.buttplug.setLinearRange(min / 100, max / 100);
    if (labelEl) labelEl.textContent = `${min}% – ${max}%`;
  }
}
