import { selectTextTrack, selectTime } from '@videojs/core/dom';
import { snapToChapter } from '../features/chapters';
import type { AppPlayerElement } from '../player';

/** Pointer distance, in pixels, within which a press or drag snaps to a chapter start. */
const SNAP_DISTANCE_PX = 12;
const SNAP_NUDGE_PX = 0.05;

const EVENTS = ['pointerdown', 'pointermove', 'pointerup'] as const;

/**
 * Snaps presses and drags on the enclosing `<media-time-slider>` to chapter starts.
 *
 * The slider derives its value from `clientX` and offers no hook to transform it, so the
 * original pointer event is swallowed and re-dispatched at the snapped position. Hold Shift
 * to seek freely.
 */
class ChapterSnapElement extends HTMLElement {
    static readonly tagName = 'media-chapter-snap';

    #slider: HTMLElement | null = null;
    #abort: AbortController | null = null;
    #pressed = false;
    readonly #redispatched = new WeakSet<Event>();

    connectedCallback(): void {
        this.hidden = true;
        this.#slider = this.closest<HTMLElement>('media-time-slider');
        if (!this.#slider) return;
        this.#abort = new AbortController();
        for (const type of EVENTS) {
            this.#slider.addEventListener(type, this.#handle, { capture: true, signal: this.#abort.signal });
        }
    }

    disconnectedCallback(): void {
        this.#abort?.abort();
        this.#abort = null;
        this.#slider = null;
        this.#pressed = false;
    }

    #handle = (event: PointerEvent): void => {
        const slider = this.#slider;
        if (!slider || this.#redispatched.has(event)) return;

        if (event.type === 'pointerdown') this.#pressed = true;
        const pressed = this.#pressed;
        if (event.type === 'pointerup') this.#pressed = false;
        if (!pressed || event.shiftKey) return;

        const state = this.closest<AppPlayerElement>('video-player')?.store.state;
        const starts = (state && selectTextTrack(state)?.chaptersCues.map((cue) => cue.startTime)) ?? [];
        const duration = (state && selectTime(state)?.duration) ?? 0;
        const rect = slider.getBoundingClientRect();
        if (starts.length === 0 || !(duration > 0) || rect.width <= 0) return;

        const fraction = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
        const time = fraction * duration;
        const snapped = snapToChapter(time, starts, (SNAP_DISTANCE_PX / rect.width) * duration);
        if (snapped === time) return;

        event.stopImmediatePropagation();
        event.preventDefault();
        const clone = new PointerEvent(event.type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            button: event.button,
            buttons: event.buttons,
            pressure: event.pressure,
            width: event.width,
            height: event.height,
            // Nudge past the boundary so rounding cannot land in the previous chapter.
            clientX: rect.left + (snapped / duration) * rect.width + SNAP_NUDGE_PX,
            clientY: event.clientY,
            screenY: event.screenY,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        });
        this.#redispatched.add(clone);
        slider.dispatchEvent(clone);
    };
}

customElements.define(ChapterSnapElement.tagName, ChapterSnapElement);
