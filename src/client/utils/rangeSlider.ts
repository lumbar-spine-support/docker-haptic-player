/**
 * Drag-only range slider behaviour shared by the settings sidebar controls.
 *
 * Native range inputs jump to arbitrary rail positions on click/tap, which breaks
 * the drag-only UX requirement, so pointer handling is fully owned here.
 */

/** Thumb diameter in px, matching `$thumb-size: 1rem` in _variables.scss. */
function thumbSizePx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export function bindDragOnlyRange(sliderEl: HTMLInputElement): void {
  if (!sliderEl || sliderEl.dataset.dragOnlyBound === 'true') return;
  sliderEl.dataset.dragOnlyBound = 'true';
  sliderEl.style.touchAction = 'none';
  let blockedPointerValue: string | null = null;
  let isDragging = false;
  const isVerticalSlider = sliderEl.classList.contains('volume-range');

  const pointerIsOnThumb = (event: MouseEvent | PointerEvent): boolean => {
    const rect = sliderEl.getBoundingClientRect();
    const min = Number(sliderEl.min || 0);
    const max = Number(sliderEl.max || 100);
    const value = Number(sliderEl.value);
    const ratio = (value - min) / Math.max(1, max - min);
    const thumbCenterX = rect.left + ratio * rect.width;
    const thumbCenterY = rect.top + ratio * rect.height;
    const thumbRadius = Math.max(12, rect.height * 0.6);
    if (isVerticalSlider) {
      return Math.abs(event.clientY - thumbCenterY) <= thumbRadius;
    }
    return Math.abs(event.clientX - thumbCenterX) <= thumbRadius;
  };

  // Native range inputs happily jump to arbitrary rail positions on click/tap,
  // which breaks the drag-only UX requirement. Once a pointer starts on the
  // thumb, we fully own the value update path with pointer capture.
  const updateFromPointer = (event: PointerEvent): void => {
    const rect = sliderEl.getBoundingClientRect();
    const min = Number(sliderEl.min || 0);
    const max = Number(sliderEl.max || 100);
    const step = Number(sliderEl.step || 1);
    let ratio: number;
    if (isVerticalSlider) {
      ratio = Math.max(0, Math.min(1, (rect.bottom - event.clientY) / Math.max(1, rect.height)));
    } else {
      ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    }
    const value = Math.round((min + ratio * (max - min)) / step) * step;
    sliderEl.value = String(Math.max(min, Math.min(max, value)));
    sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  syncRangeFill(sliderEl);

  sliderEl.addEventListener('pointerdown', (event) => {
    if (pointerIsOnThumb(event)) {
      event.preventDefault();
      isDragging = true;
      sliderEl.setPointerCapture(event.pointerId);
      return;
    }
    blockedPointerValue = sliderEl.value;
    event.preventDefault();
    event.stopPropagation();
  });

  sliderEl.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (!touch || pointerIsOnThumb({ clientX: touch.clientX, clientY: touch.clientY } as PointerEvent)) return;
    blockedPointerValue = sliderEl.value;
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });

  sliderEl.addEventListener('input', () => {
    syncRangeFill(sliderEl);
    if (blockedPointerValue === null || isDragging) return;
    const originalValue = blockedPointerValue;
    blockedPointerValue = null;
    if (sliderEl.value !== originalValue) {
      sliderEl.value = originalValue;
      sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);

  sliderEl.addEventListener('pointermove', (event) => {
    if (isDragging) updateFromPointer(event);
  });

  const stopDragging = (event: PointerEvent): void => {
    if (!isDragging) return;
    if (sliderEl.hasPointerCapture(event.pointerId)) sliderEl.releasePointerCapture(event.pointerId);
    isDragging = false;
  };
  sliderEl.addEventListener('pointerup', stopDragging);
  sliderEl.addEventListener('pointercancel', stopDragging);

  sliderEl.addEventListener('click', (event) => {
    if (blockedPointerValue !== null || !pointerIsOnThumb(event)) {
      if (blockedPointerValue !== null && sliderEl.value !== blockedPointerValue) {
        sliderEl.value = blockedPointerValue;
        sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      blockedPointerValue = null;
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

export function syncRangeFill(sliderEl: HTMLInputElement): void {
  const min = Number(sliderEl.min || 0);
  const max = Number(sliderEl.max || 100);
  const value = Number(sliderEl.value);
  const range = Math.max(1, max - min);
  const ratio = Math.max(0, Math.min(1, (value - min) / range));
  sliderEl.style.setProperty('--range-progress', `${ratio * 100}%`);

  if (sliderEl.classList.contains('zero-centered-range')) {
    const zeroRatio = Math.max(0, Math.min(1, (0 - min) / range));
    const valueRatio = Math.max(0, Math.min(1, (value - min) / range));
    const fillStart = Math.min(zeroRatio, valueRatio) * 100;
    const fillEnd = Math.max(zeroRatio, valueRatio) * 100;
    sliderEl.style.setProperty('--zero-position', `${zeroRatio * 100}%`);
    sliderEl.style.setProperty('--fill-start', `${fillStart}%`);
    sliderEl.style.setProperty('--fill-end', `${fillEnd}%`);
  }
}

export function syncDualRangeFill(container: HTMLElement, minSlider: HTMLInputElement, maxSlider: HTMLInputElement): void {
  const fill = container.querySelector<HTMLElement>('.dual-range-fill');
  if (!fill) return;

  const min = Number(minSlider.min || 0);
  const max = Number(maxSlider.max || 100);
  const containerWidth = container.clientWidth || 1;
  const rangeWidth = Math.max(1, max - min);
  const startValue = Number(minSlider.value);
  const endValue = Number(maxSlider.value);

  // Native thumbs travel within (containerWidth - thumbSize), inset by half a
  // thumb on each side; match that here so the fill lines up with the handles.
  const thumb = thumbSizePx();
  const usableWidth = Math.max(1, containerWidth - thumb);
  const startPx = thumb / 2 + (startValue - min) / rangeWidth * usableWidth;
  const endPx = thumb / 2 + (endValue - min) / rangeWidth * usableWidth;

  fill.style.left = `${startPx}px`;
  fill.style.width = `${Math.max(0, endPx - startPx)}px`;
}

export function bindDualRangeDragOnly(
  container: HTMLElement,
  minSlider: HTMLInputElement,
  maxSlider: HTMLInputElement,
): void {
  if (container.dataset.dragOnlyBound === 'true') return;
  container.dataset.dragOnlyBound = 'true';
  let activeSlider: HTMLInputElement | null = null;

  const updateFromPointer = (event: PointerEvent): void => {
    if (!activeSlider) return;
    const rect = container.getBoundingClientRect();
    const thumb = thumbSizePx();
    const usableWidth = Math.max(1, rect.width - thumb);
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - thumb / 2) / usableWidth));
    const min = Number(activeSlider.min || 0);
    const max = Number(activeSlider.max || 100);
    const step = Number(activeSlider.step || 1);
    const value = Math.round((min + ratio * (max - min)) / step) * step;
    activeSlider.value = String(Math.max(min, Math.min(max, value)));
    activeSlider.dispatchEvent(new Event('input', { bubbles: true }));
  };

  container.addEventListener('pointerdown', (event) => {
    const rect = container.getBoundingClientRect();
    const thumb = thumbSizePx();
    const usableWidth = Math.max(1, rect.width - thumb);
    const thumbRadius = Math.max(12, rect.height * 0.6);
    const pointerX = event.clientX;
    const candidates = [minSlider, maxSlider]
      .map((slider) => ({
        slider,
        distance: Math.abs(pointerX - (rect.left + thumb / 2 + (Number(slider.value) / 100) * usableWidth)),
      }))
      .filter((candidate) => candidate.distance <= thumbRadius)
      .sort((a, b) => a.distance - b.distance);
    if (candidates.length === 0) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    activeSlider = candidates[0].slider;
    activeSlider.focus();
    container.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  });

  container.addEventListener('pointermove', (event) => {
    updateFromPointer(event);
    syncDualRangeFill(container, minSlider, maxSlider);
  });
  const stopDragging = (event: PointerEvent): void => {
    if (!activeSlider) return;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    activeSlider = null;
  };
  container.addEventListener('pointerup', stopDragging);
  container.addEventListener('pointercancel', stopDragging);
}
