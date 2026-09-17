import type { Library } from '../library';
import type { PlaybackQueue } from './queue';
import type { PlaybackSession } from './session';
import type { PlaybackRequest, QueueSource, TrackInfo } from '../../../shared/types';
import { artworkUrl, mediaUrl, FALLBACK_ART_DATA_URI } from '../../utils';

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

    constructor(
        private readonly library: Library,
        private readonly queue: PlaybackQueue,
        private readonly session: PlaybackSession,
    ) {
        this.session.onChange(() => this.onSessionChange());
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
        this.queue.load(this.contextFor(track, source), trackId, source ?? this.sourceFor(track));
        this.session.loadActive(this.toRequest(track));
        await this.session.play(0);
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
                const source = this.pendingSource ?? this.sourceFor(track);
                this.queue.load(this.contextFor(track, source), track.id, source);
            }
            this.pendingSource = null;
            for (const listener of this.trackListeners) listener(track);
        }

        const ended = this.session.activeStore.state.ended;
        if (ended && !this.wasEnded && this.queue.autoplay) void this.step(1);
        this.wasEnded = ended;
    }

    /** Queue membership comes from the catalog, not from the queue itself. */
    private contextFor(track: TrackInfo, source?: QueueSource): string[] {
        if (source?.type === 'playlist') {
            const playlist = this.library.getPlaylist(source.id);
            if (playlist) return playlist.entries.map((entry) => entry.trackId);
        }
        if (source?.type === 'album') {
            const album = this.library.getAlbum(source.id);
            if (album) return album.trackIds;
        }
        const playlist = this.library.findPlaylistForTrack(track.id);
        if (playlist) return playlist.entries.map((entry) => entry.trackId);
        return this.library.findAlbumForTrack(track.id)?.trackIds ?? [track.id];
    }

    private sourceFor(track: TrackInfo): QueueSource {
        const playlist = this.library.findPlaylistForTrack(track.id);
        if (playlist) return { type: 'playlist', id: playlist.id };
        const album = this.library.findAlbumForTrack(track.id);
        if (album) return { type: 'album', id: album.id };
        return { type: 'single' };
    }

    private toRequest(track: TrackInfo): PlaybackRequest {
        return {
            id: track.id,
            type: track.type,
            src: mediaUrl(track.id),
            title: track.title,
            artist: track.artist || track.filename,
            poster: track.hasArtwork ? artworkUrl(track.id) : FALLBACK_ART_DATA_URI,
        };
    }
}
