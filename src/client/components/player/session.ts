import type { VideoPlayerStore } from '@videojs/html';
import type { VideoPlayerElement } from '@videojs/html/video';
import type { PlaybackRequest } from '../../../shared/types';
import { selectLoop } from '@/components/videojs/features/loop';

interface PlayerSlot {
    readonly el: VideoPlayerElement;
    readonly host: HTMLElement;
    readonly artistEl: HTMLElement | null;
    readonly yearEl: HTMLElement | null;
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
    private focusedVisible = false;
    private readonly listeners = new Set<() => void>();
    private readonly storeAbort = new AbortController();
    private readonly visibilityObserver: MutationObserver;

    /** Waits for the custom elements to upgrade so `store` is available. */
    static async create(hosts: [HTMLElement, HTMLElement]): Promise<PlaybackSession> {
        await customElements.whenDefined('video-player');
        return new PlaybackSession(hosts);
    }

    private constructor(hosts: [HTMLElement, HTMLElement]) {
        this.slots = hosts.map((host) => {
            const el = host.querySelector<VideoPlayerElement>('video-player');
            if (!el) throw new Error('PlaybackSession requires a <video-player> inside each host element');
            return {
                el,
                host,
                artistEl: host.querySelector<HTMLElement>('.player-artist'),
                yearEl: host.querySelector<HTMLElement>('.player-year'),
                request: null,
            };
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

        // Watches each host's actual ancestor chain, so a hidden container anywhere
        // above it (however the page is routed) is picked up without naming it.
        this.visibilityObserver = new MutationObserver(() => this.syncFocusedVisible());
        for (const slot of this.slots) {
            for (let node: HTMLElement | null = slot.host; node; node = node.parentElement) {
                this.visibilityObserver.observe(node, { attributes: true, attributeFilter: ['class'] });
            }
        }

        this.applyVisibility();
        this.syncFocusedVisible();
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
        return this.focusedVisible && this.focusIndex === this.activeIndex;
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
        this.syncFocusedVisible();
        this.emit();
    }

    /**
     * Explicit play request. The slot on screen takes it over when it is already
     * showing that track, so starting an album from its page plays the player
     * the user is looking at instead of the hidden one; anything else (a queue
     * step while browsing elsewhere) stays with the slot that owns playback.
     */
    async start(request: PlaybackRequest): Promise<void> {
        const index = this.slots[this.focusIndex].request?.id === request.id ? this.focusIndex : this.activeIndex;
        const reused = this.slots[index].request?.id === request.id;
        this.loadSlot(index, request);
        this.emit();
        const store = this.slots[index].el.store;
        // A freshly loaded source already starts at zero, and seeking it would
        // block on metadata that has not arrived yet.
        if (reused) await store.seek(0);
        await store.play();
    }

    /** Applies native looping to both slots, so a handoff keeps repeat-one on. */
    setLoop(value: boolean): void {
        for (const slot of this.slots) selectLoop(slot.el.store.state)?.setLoop(value);
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    destroy(): void {
        this.storeAbort.abort();
        this.visibilityObserver.disconnect();
        this.listeners.clear();
    }

    /** The single handoff point: the slot that just started playing takes over. */
    private promote(index: number): void {
        if (index === this.activeIndex) return;
        this.slots[this.activeIndex].el.store.pause();
        this.activeIndex = index;
        this.applyVisibility();
        this.syncFocusedVisible();
        this.emit();
    }

    private syncFocusedVisible(): void {
        const visible = this.slots[this.focusIndex].host.offsetParent !== null;
        if (visible === this.focusedVisible) return;
        this.focusedVisible = visible;
        this.emit();
    }

    private loadSlot(index: number, request: PlaybackRequest): void {
        const slot = this.slots[index];
        if (slot.request?.id !== request.id) {
            slot.el.store.pause();
            slot.el.store.loadSource(request.src);
        }
        const artist = request.artist.trim();
        const year = request.year.trim();
        slot.el.setAttribute('content-title', request.title);
        if (slot.artistEl) {
            slot.artistEl.textContent = artist;
            slot.artistEl.classList.toggle('d-none', !artist);
        }
        if (slot.yearEl) {
            slot.yearEl.textContent = year;
            slot.yearEl.classList.toggle('d-none', !year);
        }
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
