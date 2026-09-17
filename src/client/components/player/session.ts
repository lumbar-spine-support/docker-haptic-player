import type { VideoPlayerStore } from '@videojs/html';
import type { VideoPlayerElement } from '@videojs/html/video';
import type { PlaybackRequest } from '../../../shared/types';

interface PlayerSlot {
    readonly el: VideoPlayerElement;
    readonly host: HTMLElement;
    request: PlaybackRequest | null;
}

/**
 * Owns the two interchangeable player instances.
 *
 * Neither slot is permanently "the playback player" or "the preview player":
 * one slot is *active* (it owns playback, the footer bar and the haptics) and
 * one slot is *focused* (it is the one visible on the browsed file page).
 * Pressing play on the focused slot promotes it to active, so nothing is ever
 * reloaded or moved between elements and fullscreen/PiP survive the handoff.
 */
export class PlaybackSession {
    private readonly slots: [PlayerSlot, PlayerSlot];
    private activeIndex = 0;
    private focusIndex = 0;
    private readonly listeners = new Set<() => void>();
    private readonly storeAbort = new AbortController();

    /** Waits for the custom elements to upgrade so `store` is available. */
    static async create(hosts: [HTMLElement, HTMLElement]): Promise<PlaybackSession> {
        await customElements.whenDefined('video-player');
        return new PlaybackSession(hosts);
    }

    private constructor(hosts: [HTMLElement, HTMLElement]) {
        this.slots = hosts.map((host) => {
            const el = host.querySelector<VideoPlayerElement>('video-player');
            if (!el) throw new Error('PlaybackSession requires a <video-player> inside each host element');
            return { el, host, request: null };
        }) as [PlayerSlot, PlayerSlot];

        for (const [index, slot] of this.slots.entries()) {
            let wasPaused = true;
            slot.el.store.subscribe(() => {
                const { paused } = slot.el.store.state;
                if (!paused && wasPaused) this.promote(index);
                wasPaused = paused;
                this.emit();
            }, { signal: this.storeAbort.signal });
        }

        this.applyVisibility();
    }

    /** Store of the slot that owns playback — what the footer bar and haptics follow. */
    get activeStore(): VideoPlayerStore {
        return this.slots[this.activeIndex].el.store;
    }

    /** Store of the slot rendered on the browsed file page. */
    get focusedStore(): VideoPlayerStore {
        return this.slots[this.focusIndex].el.store;
    }

    /** Both stores, in slot order, for consumers that bind one controller per player. */
    get stores(): [VideoPlayerStore, VideoPlayerStore] {
        return [this.slots[0].el.store, this.slots[1].el.store];
    }

    /** Index of the slot that currently owns playback. */
    get activeSlot(): number {
        return this.activeIndex;
    }

    /** Track currently owning playback, or null before anything was played. */
    get activeTrackId(): string | null {
        return this.slots[this.activeIndex].request?.id ?? null;
    }

    get activeRequest(): PlaybackRequest | null {
        return this.slots[this.activeIndex].request;
    }

    get focusedTrackId(): string | null {
        return this.slots[this.focusIndex].request?.id ?? null;
    }

    /** Whether the browsed page shows the playing track itself. */
    get focusedIsActive(): boolean {
        return this.focusIndex === this.activeIndex;
    }

    /**
     * Shows `request` on the file page in a stopped state.
     * The active slot is reused when it already holds that track, so returning to
     * the playing track's page never restarts it.
     */
    browse(request: PlaybackRequest): void {
        if (this.activeTrackId === request.id) {
            this.focusIndex = this.activeIndex;
        } else {
            this.focusIndex = 1 - this.activeIndex;
            this.loadSlot(this.focusIndex, request);
        }
        this.applyVisibility();
        this.emit();
    }

    /** Replaces the track in the active slot, e.g. when the queue advances. */
    loadActive(request: PlaybackRequest): void {
        this.loadSlot(this.activeIndex, request);
        this.applyVisibility();
        this.emit();
    }

    /** Starts the active slot, optionally from a given offset. */
    async play(at?: number): Promise<void> {
        const store = this.activeStore;
        if (at !== undefined) await store.seek(at);
        await store.play();
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    destroy(): void {
        this.storeAbort.abort();
        this.listeners.clear();
    }

    /** The single handoff point: the slot that just started playing takes over. */
    private promote(index: number): void {
        if (index === this.activeIndex) return;
        this.slots[this.activeIndex].el.store.pause();
        this.activeIndex = index;
        this.applyVisibility();
        this.emit();
    }

    private loadSlot(index: number, request: PlaybackRequest): void {
        const slot = this.slots[index];
        if (slot.request?.id !== request.id) {
            slot.el.store.pause();
            slot.el.store.loadSource(request.src);
        }
        const artist = request.artist.trim();
        slot.el.setAttribute('content-title', artist ? `${request.title} - ${artist}` : request.title);
        slot.el.setAttribute('poster', request.poster);
        // Audio has no frames, so the skin keeps the poster up as a pseudo-video surface.
        slot.el.classList.toggle('audio-only', request.type === 'audio');
        slot.request = request;
    }

    private applyVisibility(): void {
        for (const [index, slot] of this.slots.entries()) {
            slot.host.classList.toggle('d-none', index !== this.focusIndex);
        }
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}
