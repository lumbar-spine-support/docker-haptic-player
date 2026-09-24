import {
  FUNSCRIPT_TYPES,
  channelKey,
  channelLabel,
  parseChannelKey,
  type HapticChannel,
} from '../../../shared/haptics';
import { bindDragOnlyRange, bindDualRangeDragOnly, syncDualRangeFill, syncRangeFill } from '../../utils/rangeSlider';
import type { DeviceFeature, HapticBackend, HapticDevice } from './backend';

/** Minimum gap (percentage points) enforced between the stroker min and max handles. */
const MIN_GAP = 10;
const STEP = 5;

/**
 * Renders a card per connected device inside a given container element.
 *
 * Each card shows the device name, battery level, a device-specific strength
 * slider and one dropdown per actuator, so a single toy can drive its vibrator
 * and its rotator from two different scripts.
 */
export class DeviceAssignment {
  private readonly buttplug: HapticBackend;
  private container: HTMLElement | null = null;
  /** Channels present in the current track; merged with the plain base types. */
  private trackChannels: HapticChannel[] = [];

  constructor(buttplug: HapticBackend) {
    this.buttplug = buttplug;
    buttplug.onDevicesChange(() => this.render());
    buttplug.onAssignmentsChange(() => this.render());
    buttplug.onStateChange(() => this.render());
  }

  /** Mounts and renders the device list into the provided container. */
  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  /** Re-render the device list and re-fetch battery levels. Call when the sidebar is opened. */
  refresh(): void {
    this.render();
  }

  /** Report the channels of the current track so subcategories become assignable. */
  setAvailableChannels(channels: HapticChannel[]): void {
    this.trackChannels = channels;
    this.render();
  }

  private render(): void {
    const container = this.container;
    if (!container) return;

    const devices = this.buttplug.devices;
    container.innerHTML = '';

    if (devices.length === 0) {
      return;
    }

    for (const device of devices) {
      container.appendChild(this.buildDeviceCard(device));
    }
  }

  /** Base types plus any subcategory channels found in the current track. */
  private selectableChannels(): HapticChannel[] {
    const channels: HapticChannel[] = FUNSCRIPT_TYPES.map((type) => ({ type }));
    for (const channel of this.trackChannels) {
      if (!channel.sub) continue;
      if (!channels.some((c) => channelKey(c) === channelKey(channel))) channels.push(channel);
    }
    return channels;
  }

  private buildDeviceCard(device: HapticDevice): HTMLElement {
    const card = document.createElement('div');
    card.className = 'device-card mb-2 p-2 border border-secondary rounded bg-dark';

    // --- Header row: name + battery ---
    const header = document.createElement('div');
    header.className = 'd-flex align-items-center mb-2';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'fw-semibold text-truncate flex-grow-1 small';
    nameSpan.title = device.name;
    nameSpan.textContent = device.name;

    const battHeaderEl = document.createElement('div');
    battHeaderEl.className = 'text-muted small flex-shrink-0';
    battHeaderEl.innerHTML = '<i class="bi bi-battery me-1"></i>…';

    header.appendChild(nameSpan);
    header.appendChild(battHeaderEl);
    card.appendChild(header);

    void this.buttplug.getBatteryLevel(device).then((level) => {
      if (level === null) {
        battHeaderEl.textContent = '';
      } else {
        battHeaderEl.innerHTML = `<i class="bi bi-battery me-1"></i>${Math.round(level * 100)}%`;
      }
    });

    const features = this.buttplug.getFeatures(device);

    // A strength slider only makes sense for actuators with an intensity (not pure position).
    if (features.some((feature) => feature.kind !== 'linear')) {
      card.appendChild(this.buildStrengthRow(device));
    }

    if (features.length === 0) {
      const none = document.createElement('div');
      none.className = 'text-muted small';
      none.textContent = 'No controllable features.';
      card.appendChild(none);
      return card;
    }

    for (const feature of features) {
      card.appendChild(this.buildFeatureRow(feature));
    }

    // Position travel limits only make sense for a toy that reports a linear actuator.
    if (features.some((feature) => feature.kind === 'linear')) {
      card.appendChild(this.buildStrokerRangeRow(device));
    }

    const frequency = this.buttplug.getCarrierFrequency?.(device.name);
    if (typeof frequency === 'number') {
      card.appendChild(this.buildFrequencyRow(device, frequency));
    }

    return card;
  }

  /** Carrier frequency of a pulse-based device, e.g. a DG-Lab Coyote channel pair. */
  private buildFrequencyRow(device: HapticDevice, initial: number): HTMLElement {
    const { row, value } = buildControl('Pulse Frequency', String(initial));

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'form-range handle-only-range';
    slider.min = '1';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(initial);
    slider.setAttribute('aria-label', `Pulse frequency for ${device.name}`);
    slider.addEventListener('input', () => {
      const hz = Number(slider.value);
      value.textContent = String(hz);
      this.buttplug.setCarrierFrequency?.(device.name, hz);
    });

    row.appendChild(slider);
    bindDragOnlyRange(slider);
    syncRangeFill(slider);
    return row;
  }

  /** Per-toy strength, multiplied with the master strength when commands are sent. */
  private buildStrengthRow(device: HapticDevice): HTMLElement {
    const initial = Math.round(this.buttplug.getDeviceStrength(device.name) * 100);
    const { row, value } = buildControl('Strength', `${initial}%`);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'form-range handle-only-range';
    slider.min = '0';
    slider.max = '100';
    slider.step = String(STEP);
    slider.value = String(initial);
    slider.setAttribute('aria-label', `Haptic strength for ${device.name}`);
    slider.addEventListener('input', () => {
      const percent = Number(slider.value);
      value.textContent = `${percent}%`;
      this.buttplug.setDeviceStrength(device.name, percent / 100);
    });

    row.appendChild(slider);
    bindDragOnlyRange(slider);
    syncRangeFill(slider);
    return row;
  }

  /** Dual-handle travel limits for linear toys, rescaling stroker positions. */
  private buildStrokerRangeRow(device: HapticDevice): HTMLElement {
    const initialMin = snap(this.buttplug.linearRangeMin * 100);
    const initialMax = snap(this.buttplug.linearRangeMax * 100);
    const { row, value } = buildControl('Position Limits', `${initialMin}% – ${initialMax}%`);

    const container = document.createElement('div');
    container.className = 'dual-range';
    container.innerHTML =
      '<div class="dual-range-track" aria-hidden="true"></div><div class="dual-range-fill" aria-hidden="true"></div>';

    const minEl = buildRangeInput('dual-range-input-first', initialMin, `Minimum position for ${device.name}`);
    const maxEl = buildRangeInput('dual-range-input-second', initialMax, `Maximum position for ${device.name}`);
    container.appendChild(minEl);
    container.appendChild(maxEl);

    const apply = (): void => {
      const min = snap(Number(minEl.value));
      const max = snap(Number(maxEl.value));
      minEl.value = String(min);
      maxEl.value = String(max);
      value.textContent = `${min}% – ${max}%`;
      this.buttplug.setLinearRange(min / 100, max / 100);
      syncDualRangeFill(container, minEl, maxEl);
    };

    minEl.addEventListener('input', () => {
      minEl.value = String(Math.min(snap(Number(minEl.value)), Math.max(0, Number(maxEl.value) - MIN_GAP)));
      apply();
    });
    maxEl.addEventListener('input', () => {
      maxEl.value = String(Math.max(snap(Number(maxEl.value)), Math.min(100, Number(minEl.value) + MIN_GAP)));
      apply();
    });

    row.appendChild(container);
    bindDualRangeDragOnly(container, minEl, maxEl);
    // The card is off-screen until the sidebar opens, so the fill needs a late resync.
    requestAnimationFrame(() => syncDualRangeFill(container, minEl, maxEl));
    return row;
  }

  private buildFeatureRow(feature: DeviceFeature): HTMLElement {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center gap-2 mb-1';

    const label = document.createElement('span');
    label.className = 'text-muted small text-truncate';
    label.style.flex = '0 0 6.5rem';
    label.title = feature.descriptor || feature.label;
    label.textContent = feature.label;

    const select = document.createElement('select');
    select.className = 'form-select form-select-sm bg-dark text-light border-secondary';
    select.setAttribute('aria-label', `Assign script for ${feature.deviceName} ${feature.label}`);

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— Assign Script —';
    select.appendChild(noneOpt);

    for (const channel of this.selectableChannels()) {
      const opt = document.createElement('option');
      opt.value = channelKey(channel);
      opt.textContent = channelLabel(channel);
      select.appendChild(opt);
    }

    select.value = this.buttplug.getFeatureChannel(feature.id) ?? '';
    select.addEventListener('change', () => {
      this.buttplug.setFeatureChannel(feature.id, select.value ? parseChannelKey(select.value) : null);
    });

    row.appendChild(label);
    row.appendChild(select);
    return row;
  }
}

function snap(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value / STEP) * STEP));
}

/** Labelled settings row matching the sidebar controls in `index.html`. */
function buildControl(title: string, initialValue: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'settings-control mb-2';

  const label = document.createElement('label');
  // Elements built via createElement have no whitespace text node between them
  // (unlike the static HTML markup), so an explicit flex layout keeps title
  // and value apart instead of visually running together.
  label.className = 'form-label small d-flex justify-content-between';

  const text = document.createElement('span');
  text.textContent = title;

  const value = document.createElement('span');
  value.className = 'text-muted';
  value.textContent = initialValue;

  label.appendChild(text);
  label.appendChild(value);
  row.appendChild(label);
  return { row, value };
}

function buildRangeInput(variantClass: string, value: number, ariaLabel: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.className = `form-range dual-range-input ${variantClass}`;
  input.min = '0';
  input.max = '100';
  input.step = String(STEP);
  input.value = String(value);
  input.setAttribute('aria-label', ariaLabel);
  return input;
}
