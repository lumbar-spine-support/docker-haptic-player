import { CHAPTERS_CHANGE_EVENT, getMediaChapters, snapToChapter } from '../features/chapters';
import './chapter-markers.css';

/** Pointer distance, in pixels, within which a press or drag snaps to a chapter start. */
const SNAP_DISTANCE_PX = 12;
const SNAP_NUDGE_PX = 0.05;

const EVENTS = ['pointerdown', 'pointermove', 'pointerup'] as const;
const MEDIA_EVENTS = [CHAPTERS_CHANGE_EVENT, 'durationchange', 'loadedmetadata', 'emptied'] as const;

/**
 * Draws a line at every chapter start of the enclosing `<media-time-slider>` and snaps
 * presses and drags to them.
 *
 * The slider derives its value from `clientX` and offers no hook to transform it, so the
 * original pointer event is swallowed and re-dispatched at the snapped position. Hold Shift
 * to seek freely.
 */
class ChapterMarkersElement extends HTMLElement {
    static readonly tagName = 'media-chapter-markers';

    #slider: HTMLElement | null = null;
    #abort: AbortController | null = null;
    #pressed = false;
    readonly #redispatched = new WeakSet<Event>();

    connectedCallback(): void {
        this.setAttribute('aria-hidden', 'true');
        this.#slider = this.closest<HTMLElement>('media-time-slider');
        if (!this.#slider) return;
        this.#abort = new AbortController();
        const { signal } = this.#abort;
        for (const type of EVENTS) {
            this.#slider.addEventListener(type, this.#handle, { capture: true, signal });
        }
        // Media events do not bubble, but they pass the player in the capture phase.
        const player = this.closest('video-player');
        for (const type of MEDIA_EVENTS) {
            player?.addEventListener(type, this.#render, { capture: true, signal });
        }
        this.#render();
    }

    disconnectedCallback(): void {
        this.#abort?.abort();
        this.#abort = null;
        this.#slider = null;
        this.#pressed = false;
    }

    #media(): HTMLMediaElement | null {
        return this.#slider?.closest('video-player')?.querySelector<HTMLMediaElement>('video, audio') ?? null;
    }

    #render = (): void => {
        const media = this.#media();
        const duration = media?.duration ?? NaN;
        const markers = duration > 0
            ? getMediaChapters(media).filter((chapter) => chapter.start > 0 && chapter.start < duration)
            : [];
        this.replaceChildren(...markers.map((chapter) => {
            const marker = document.createElement('span');
            marker.className = 'media-chapter-marker';
            marker.style.left = `${(chapter.start / duration) * 100}%`;
            return marker;
        }));
    };

    #handle = (event: PointerEvent): void => {
        const slider = this.#slider;
        if (!slider || this.#redispatched.has(event)) return;

        if (event.type === 'pointerdown') this.#pressed = true;
        const pressed = this.#pressed;
        if (event.type === 'pointerup') this.#pressed = false;
        if (!pressed || event.shiftKey) return;

        const media = this.#media();
        const chapters = getMediaChapters(media);
        const duration = media?.duration ?? NaN;
        const rect = slider.getBoundingClientRect();
        if (chapters.length === 0 || !(duration > 0) || rect.width <= 0) return;

        const fraction = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
        const time = fraction * duration;
        const snapped = snapToChapter(time, chapters, (SNAP_DISTANCE_PX / rect.width) * duration);
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

customElements.define(ChapterMarkersElement.tagName, ChapterMarkersElement);
