const DRAG_THRESHOLD_PX = 6;

/** Marks elements whose drags must not end in the skin's tap/double-tap gestures. */
export const DRAG_SURFACE_ATTR = 'data-vr-surface';

/**
 * Swallows the `pointerup` that ends a drag on a drag surface, so the skin's
 * `<media-gesture>` taps (which listen for `pointerup` on the container) only see real taps.
 */
export function installDragGuard(container: HTMLElement, isActive: () => boolean, signal: AbortSignal): void {
    const starts = new Map<number, { x: number; y: number; dragged: boolean }>();
    const onSurface = (event: Event) =>
        event.target instanceof Element && event.target.closest(`[${DRAG_SURFACE_ATTR}]`) !== null;

    container.addEventListener('pointerdown', (event) => {
        if (!isActive() || !onSurface(event)) return;
        const multi = starts.size > 0;
        starts.set(event.pointerId, { x: event.clientX, y: event.clientY, dragged: multi });
        // A second finger turns every active pointer into a pinch, never a tap.
        if (multi) for (const start of starts.values()) start.dragged = true;
    }, { capture: true, signal });

    container.addEventListener('pointermove', (event) => {
        const start = starts.get(event.pointerId);
        if (!start || start.dragged) return;
        start.dragged = Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD_PX;
    }, { capture: true, signal });

    const end = (event: PointerEvent) => {
        const start = starts.get(event.pointerId);
        starts.delete(event.pointerId);
        if (start?.dragged && event.type === 'pointerup') event.stopPropagation();
    };
    container.addEventListener('pointerup', end, { capture: true, signal });
    container.addEventListener('pointercancel', end, { capture: true, signal });
}
