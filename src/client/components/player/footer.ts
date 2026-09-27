import { UIElement, selectPlayback, selectVolume } from '@videojs/html';
import type { VideoPlayerStore } from '@videojs/html';
import { StoreController } from '@videojs/store/html';
import type { PlaybackSession } from './session';
import type { PlaybackController } from './controller';
import { QueueList } from './queueList';

type PlaybackSlice = ReturnType<typeof selectPlayback>;
type VolumeSlice = ReturnType<typeof selectVolume>;

/**
 * Persistent bottom bar. It always represents the *active* player, which may be
 * a different track than the file page the user is browsing.
 *
 * One `StoreController` pair is created per player slot so the bar can follow
 * whichever slot currently owns playback without tearing down subscriptions.
 */
export class PlayerFooterElement extends UIElement {
    static readonly tagName = 'player-footer';

    #session: PlaybackSession | null = null;
    #controller: PlaybackController | null = null;
    #playback: StoreController<VideoPlayerStore, PlaybackSlice>[] = [];
    #volume: StoreController<VideoPlayerStore, VolumeSlice>[] = [];
    #onOpenTrack: ((trackId: string) => void) | null = null;
    #queueList: QueueList | null = null;
    #queueOpen = false;
    /** Bar shown on the playing file's page, where it normally collapses to the bubble. */
    #expanded = false;

    /** Wires the bar to the session; called once the players have upgraded. */
    bind(
        session: PlaybackSession,
        controller: PlaybackController,
        onOpenTrack: (trackId: string) => void,
    ): void {
        this.#session = session;
        this.#controller = controller;
        this.#onOpenTrack = onOpenTrack;
        this.#playback = session.stores.map((store) => new StoreController(this, store, selectPlayback));
        this.#volume = session.stores.map((store) => new StoreController(this, store, selectVolume));
        session.onChange(() => this.requestUpdate());
        controller.onQueueChange(() => {
            if (this.#queueOpen) this.#renderQueue();
            this.requestUpdate();
        });
        this.#bindControls();
        this.#bindQueue();
        this.requestUpdate();
    }

    #part<T extends HTMLElement>(name: string): T | null {
        return this.querySelector<T>(`[data-footer="${name}"]`);
    }


    #bindQueue(): void {
        const body = this.#part<HTMLTableSectionElement>('queue-list');
        const panel = this.#part('queue');
        if (body && panel) {
            this.#queueList = new QueueList(body, panel, {
                onMove: (from, to) => this.#controller?.moveUpcoming(from, to),
                onSelect: (index) => { void this.#controller?.jumpTo(index); },
                onRemove: (index) => this.#controller?.removeUpcoming(index),
            });
        }
        this.#part('queue-toggle')?.addEventListener('click', () => {
            if (this.#queueOpen) this.#closeQueue();
            else this.#openQueue();
        });
        this.#part('bubble')?.addEventListener('click', () => {
            if (this.#bubbleDragged) return;
            this.#expanded = true;
            this.#openQueue();
        });
        this.#bindBubbleDrag();
        this.#part('clear')?.addEventListener('click', () => this.#controller?.clearQueue());
        this.#part('add')?.addEventListener('click', () => {
            const trackId = this.#session?.focusedTrackId;
            if (trackId) this.#controller?.enqueue(trackId);
        });
        this.#part('backdrop')?.addEventListener('click', () => this.#closeQueue());
        this.#part('bar')?.addEventListener('click', (event) => {
            if (this.#expanded && !(event.target as HTMLElement).closest('button')) this.#closeQueue();
        });
    }

    #bubbleDragged = false;

    #bindBubbleDrag(): void {
        const bubble = this.#part('bubble');
        if (!bubble) return;
        let start: { x: number; y: number; right: number; bottom: number } | null = null;
        bubble.addEventListener('pointerdown', (event) => {
            const rect = bubble.getBoundingClientRect();
            start = { x: event.clientX, y: event.clientY, right: innerWidth - rect.right, bottom: innerHeight - rect.bottom };
            this.#bubbleDragged = false;
            bubble.setPointerCapture(event.pointerId);
        });
        bubble.addEventListener('pointermove', (event) => {
            if (!start) return;
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            if (Math.hypot(dx, dy) > 5) this.#bubbleDragged = true;
            if (!this.#bubbleDragged) return;
            bubble.style.right = `${Math.max(0, Math.min(innerWidth - bubble.offsetWidth, start.right - dx))}px`;
            bubble.style.bottom = `${Math.max(0, Math.min(innerHeight - bubble.offsetHeight, start.bottom - dy))}px`;
        });
        bubble.addEventListener('pointerup', () => { start = null; });
        bubble.addEventListener('pointercancel', () => { start = null; });
    }

    #openQueue(): void {
        this.#queueOpen = true;
        this.#renderQueue();
        this.requestUpdate();
    }

    /** Closing while expanded also drops back to the bubble. */
    #closeQueue(): void {
        this.#queueOpen = false;
        this.#expanded = false;
        this.requestUpdate();
    }

    #renderQueue(): void {
        const tracks = this.#controller?.upcoming ?? [];
        this.#queueList?.render(tracks);
        this.#part('queue-empty')?.classList.toggle('d-none', tracks.length > 0);
    }

    #bindControls(): void {
        this.#part('info')?.addEventListener('click', () => {
            if (this.#expanded) {
                this.#closeQueue();
                return;
            }
            const trackId = this.#session?.activeTrackId;
            if (trackId) this.#onOpenTrack?.(trackId);
        });
        for (const playPause of this.querySelectorAll('[data-footer="play-pause"]')) {
            playPause.addEventListener('click', () => { void this.#playbackSlice?.togglePaused(); });
        }
        this.#part('prev')?.addEventListener('click', () => { void this.#controller?.step(-1); });
        this.#part('next')?.addEventListener('click', () => { void this.#controller?.step(1); });
        this.#part('mute')?.addEventListener('click', () => { this.#volumeSlice?.toggleMuted(); });
        this.#part<HTMLInputElement>('volume')?.addEventListener('input', (event) => {
            const value = Number((event.currentTarget as HTMLInputElement).value);
            this.#volumeSlice?.setVolume(Math.max(0, Math.min(1, value / 100)));
        });
    }

    get #playbackSlice(): PlaybackSlice {
        return this.#playback[this.#session?.activeSlot ?? 0]?.value;
    }

    get #volumeSlice(): VolumeSlice {
        return this.#volume[this.#session?.activeSlot ?? 0]?.value;
    }

    protected override update(changed: Map<string, unknown>): void {
        super.update(changed);
        const session = this.#session;
        const request = session?.activeRequest ?? null;
        const hasQueue = this.#controller?.hasQueue ?? false;
        if (!request || !hasQueue) this.#queueOpen = false;
        if (!request) {
            this.#expanded = false;
        } else if (!session?.focusedIsActive) {
            this.#expanded = false;
        }
        const bubble = !!request && !!session?.focusedIsActive && !this.#expanded;
        const hideBar = !request || bubble;
        const showQueue = !hideBar && this.#queueOpen;
        this.classList.toggle('d-none', !request || (bubble && !hasQueue));
        this.#part('bar')?.classList.toggle('d-none', hideBar);
        this.#part('bubble')?.classList.toggle('d-none', !bubble || !hasQueue);
        this.#part('queue')?.classList.toggle('d-none', !showQueue);
        this.#part('actions')?.classList.toggle('d-none', !showQueue);
        this.#part('backdrop')?.classList.toggle('d-none', !showQueue);
        this.#part('queue-toggle')?.setAttribute('aria-expanded', String(showQueue));
        if (hideBar) return;

        const art = this.#part<HTMLImageElement>('art');
        if (art && art.src !== request.poster) art.src = request.poster;
        const title = this.#part('title');
        if (title) title.textContent = request.title;
        const subtitle = this.#part('subtitle');
        if (subtitle) subtitle.textContent = request.artist;

        const paused = this.#playbackSlice?.paused ?? true;
        const playPauseButtons = this.querySelectorAll('[data-footer="play-pause"]');
        for (const playPause of playPauseButtons) {
            playPause.setAttribute('aria-label', paused ? 'Play' : 'Pause');
            const icon = playPause.querySelector('i');
            if (icon) icon.className = paused ? 'bi bi-play-fill' : 'bi bi-pause-fill';
        }
        this.#part('bar-play')?.classList.toggle('d-none', hasQueue);
        this.#part('queue-toggle')?.classList.toggle('d-none', !hasQueue);
        const add = this.#part<HTMLButtonElement>('add');
        if (add) add.disabled = !session?.focusedTrackId;

        const steps = this.#controller?.canStep ?? { prev: false, next: false };
        const prev = this.#part<HTMLButtonElement>('prev');
        if (prev) prev.disabled = !steps.prev;
        const next = this.#part<HTMLButtonElement>('next');
        if (next) next.disabled = !steps.next;

        const volume = this.#volumeSlice;
        const mute = this.#part('mute');
        if (mute && volume) {
            const silent = volume.muted || volume.volume === 0;
            mute.setAttribute('aria-pressed', String(silent));
            mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
            const icon = mute.querySelector('i');
            if (icon) icon.className = silent ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
        }
        const slider = this.#part<HTMLInputElement>('volume');
        if (slider && volume && document.activeElement !== slider) {
            slider.value = String(Math.round(volume.volume * 100));
        }
    }
}

customElements.define(PlayerFooterElement.tagName, PlayerFooterElement);

declare global {
    interface HTMLElementTagNameMap {
        [PlayerFooterElement.tagName]: PlayerFooterElement;
    }
}
