import { UIElement, selectPlayback, selectVolume } from '@videojs/html';
import type { VideoPlayerStore } from '@videojs/html';
import { StoreController } from '@videojs/store/html';
import type { PlaybackSession } from './session';
import type { PlaybackController } from './controller';

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
        this.#bindControls();
        this.requestUpdate();
    }

    #part<T extends HTMLElement>(name: string): T | null {
        return this.querySelector<T>(`[data-footer="${name}"]`);
    }

    #bindControls(): void {
        this.#part('info')?.addEventListener('click', () => {
            const trackId = this.#session?.activeTrackId;
            if (trackId) this.#onOpenTrack?.(trackId);
        });
        this.#part('play-pause')?.addEventListener('click', () => {
            void this.#playbackSlice?.togglePaused();
        });
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
        this.classList.toggle('d-none', !request);
        if (!request) return;

        const art = this.#part<HTMLImageElement>('art');
        if (art && art.src !== request.poster) art.src = request.poster;
        const title = this.#part('title');
        if (title) title.textContent = request.title;
        const subtitle = this.#part('subtitle');
        if (subtitle) subtitle.textContent = request.artist;

        const paused = this.#playbackSlice?.paused ?? true;
        const playPause = this.#part('play-pause');
        if (playPause) {
            playPause.setAttribute('aria-label', paused ? 'Play' : 'Pause');
            const icon = playPause.querySelector('i');
            if (icon) icon.className = paused ? 'bi bi-play-fill' : 'bi bi-pause-fill';
        }

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
