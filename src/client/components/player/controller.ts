import type { Library } from '../library';
import type { PlaybackQueue } from './queue';
import type { PlaybackSession } from './session';
import type { PlaybackRequest, QueueSource, TrackInfo } from '../../../shared/types';
import { artworkUrl, mediaUrl, FALLBACK_ART_DATA_URI } from '../../utils';
import { notifySkipChanged, setSkipTarget } from '@/components/videojs/features/skip';
import { getRepeatMode, subscribeRepeat } from '@/components/videojs/features/repeat';

const SINGLE: QueueSource = { type: 'single' };

/**
 * Translates library intent ("browse this track", "skip forward") into session
 * and queue operations, and reports back when the playing track changes.
 */
export class PlaybackController {
    private readonly trackListeners = new Set<(track: TrackInfo | null) => void>();
    private lastActiveTrackId: string | null = null;
    private wasEnded = false;
    /** Queue context the browsed page hands over once its player is started. */
    private pendingSource: QueueSource | null = null;
    private lastCanStep = { prev: false, next: false };

    constructor(
        private readonly library: Library,
        private readonly queue: PlaybackQueue,
        private readonly session: PlaybackSession,
    ) {
        this.session.onChange(() => this.onSessionChange());
        setSkipTarget(this);
        subscribeRepeat(() => this.applyRepeat());
    }

    /** Entered a file page: show the track stopped, never touch playback. */
    browse(trackId: string, source?: QueueSource): void {
        const track = this.library.getTrack(trackId);
        if (!track) return;
        this.pendingSource = source ?? null;
        this.session.browse(this.toRequest(track));
    }

    /** Explicit play request (detail page, queue step): take over playback now. */
    async activate(trackId: string, source?: QueueSource): Promise<void> {
        const track = this.library.getTrack(trackId);
        if (!track) return;
        const from = source ?? SINGLE;
        this.queue.load(this.contextFor(track, from), trackId, from);
        this.applyRepeat();
        this.publishCanStep();
        await this.session.start(this.toRequest(track));
    }

    async step(direction: -1 | 1): Promise<void> {
        const id = this.queue.step(direction);
        if (id) await this.activate(id, this.queue.source);
    }

    get canStep(): { prev: boolean; next: boolean } {
        return { prev: this.queue.hasPrev, next: this.queue.hasNext };
    }

    /** Fires whenever another track takes over playback. */
    onActiveTrack(listener: (track: TrackInfo | null) => void): void {
        this.trackListeners.add(listener);
    }

    private onSessionChange(): void {
        const activeId = this.session.activeTrackId;
        if (activeId !== this.lastActiveTrackId) {
            this.lastActiveTrackId = activeId;
            const track = activeId ? this.library.getTrack(activeId) ?? null : null;
            if (track && this.queue.currentId !== track.id) {
                const source = this.pendingSource ?? SINGLE;
                this.queue.load(this.contextFor(track, source), track.id, source);
            }
            this.pendingSource = null;
            for (const listener of this.trackListeners) listener(track);
        }

        const ended = this.session.activeStore.state.ended;
        // Loading the next track emits synchronously, so the edge has to be
        // consumed before advancing or that nested emit advances again.
        const justEnded = ended && !this.wasEnded;
        this.wasEnded = ended;
        if (justEnded && this.queue.autoplay) void this.advance();
        this.publishCanStep();
    }

    /** End of a track: next in the queue, or back to the top when repeating it. */
    private async advance(): Promise<void> {
        if (this.queue.hasNext) {
            await this.step(1);
            return;
        }
        if (getRepeatMode() !== 'queue') return;
        const id = this.queue.restart();
        if (id) await this.activate(id, this.queue.source);
    }

    /** Repeat-one is the media element's own loop; the other modes leave it off. */
    private applyRepeat(): void {
        this.session.setLoop(getRepeatMode() === 'one');
    }

    private publishCanStep(): void {
        const { prev, next } = this.canStep;
        if (prev === this.lastCanStep.prev && next === this.lastCanStep.next) return;
        this.lastCanStep = { prev, next };
        notifySkipChanged();
    }

    /**
     * Queue membership comes from the catalog, but only for the collection the
     * track was opened from — a track opened on its own never gains neighbours
     * just because it happens to belong to an album.
     */
    private contextFor(track: TrackInfo, source: QueueSource): string[] {
        if (source.type === 'playlist') {
            const playlist = this.library.getPlaylist(source.id);
            if (playlist) return playlist.entries.map((entry) => entry.trackId);
        }
        if (source.type === 'album') {
            const album = this.library.getAlbum(source.id);
            if (album) return album.trackIds;
        }
        return [track.id];
    }

    private toRequest(track: TrackInfo): PlaybackRequest {
        return {
            id: track.id,
            type: track.type,
            src: mediaUrl(track.id),
            title: track.title,
            artist: track.artist || track.filename,
            year: track.year,
            poster: track.hasArtwork ? artworkUrl(track.id, track.artworkVersion) : FALLBACK_ART_DATA_URI,
        };
    }
}
