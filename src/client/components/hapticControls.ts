import type { ButtplugClientManager } from './haptic/buttplugClient';

/**
 * Binds the master haptic strength slider in the player UI.
 *
 * Per-device strength lives in the device cards (`DeviceAssignment`) and is
 * multiplied on top of this value.
 */
export class HapticControls {
  private readonly buttplug: ButtplugClientManager;

  constructor(buttplug: ButtplugClientManager) {
    this.buttplug = buttplug;
  }

  /** Wire up the slider element and set the initial value. */
  init(sliderEl: HTMLInputElement, labelEl: HTMLElement | null, initialValue: number): void {
    sliderEl.value = String(initialValue);
    this.updateDisplay(labelEl, initialValue);
    this.buttplug.masterStrength = initialValue / 100;

    sliderEl.addEventListener('input', () => {
      const value = Number(sliderEl.value);
      this.buttplug.masterStrength = value / 100;
      this.updateDisplay(labelEl, value);
    });
  }

  private updateDisplay(labelEl: HTMLElement | null, value: number): void {
    if (labelEl) labelEl.textContent = `${value}%`;
  }
}

/** Minimum gap (percentage points) enforced between the min and max handles. */
const MIN_GAP = 10;
const RANGE_STEP = 5;

/**
 * Binds the dual-handle Min/Max Position slider that rescales stroker (linear)
 * travel independently of the master haptic strength.
 */
export class StrokerRangeControls {
  private readonly buttplug: ButtplugClientManager;

  constructor(buttplug: ButtplugClientManager) {
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
