import type { FunscriptSync } from '../funscriptSync';
import { bindDragOnlyRange, syncRangeFill } from '../ui/rangeSlider';
import { qs } from '../../utils/html';
import { storedSetting } from '../../utils/storedSetting';

/** Per-backend playback offset slider, clamped to the server's limit. */
export function bindDelaySlider(engine: FunscriptSync, sliderId: string, storageKey: string, fallback: number, limit: number): void {
    const slider = qs<HTMLInputElement>(`#${sliderId}`);
    const label = qs<HTMLElement>(`#${sliderId}-label`);
    if (!slider) return;
    const delay = storedSetting(storageKey, fallback);
    slider.min = String(-limit);
    slider.max = String(limit);
    const apply = (value: number): void => {
        if (label) label.textContent = `${value > 0 ? '+' : ''}${value}ms`;
        engine.setDelayMs(value);
    };
    bindDragOnlyRange(slider);
    slider.value = String(Math.max(-limit, Math.min(limit, delay.get())));
    syncRangeFill(slider);
    apply(Number(slider.value));
    slider.addEventListener('input', () => {
        const value = Number(slider.value);
        delay.set(value);
        apply(value);
    });
}

/** Resampling rate slider shared by all sync engines; reports the initial rate and every change. */
export function bindUpdateRateSlider(fallback: number, onChange: (rateHz: number) => void): void {
    const slider = qs<HTMLInputElement>('#haptic-update-rate');
    const label = qs<HTMLElement>('#haptic-update-rate-label');
    if (!slider) return;
    const rate = storedSetting('happy-haptic-update-rate-hz', fallback);
    const apply = (value: number): void => {
        if (label) label.textContent = `${value}Hz`;
        onChange(value);
    };
    bindDragOnlyRange(slider);
    slider.value = String(Math.max(10, Math.min(240, rate.get())));
    syncRangeFill(slider);
    apply(Number(slider.value));
    slider.addEventListener('input', () => {
        const value = Number(slider.value);
        rate.set(value);
        apply(value);
    });
}
