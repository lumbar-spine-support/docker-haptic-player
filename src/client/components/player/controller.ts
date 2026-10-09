import type { Library } from '../library';
import { shuffled, type PlaybackQueue } from './queue';
import type { PlaybackSession } from './session';
import type { PlaybackRequest, QueueSource, TrackInfo } from '../../../shared/types';
import { parseVrFormat } from '../../../shared/vrFormat';
import { artworkUrl, chaptersVttUrl, mediaUrl, storyboardVttUrl, FALLBACK_ART_DATA_URI } from '../../api';
import { notifySkipChanged, setSkipTarget } from '@/components/videojs/features/skip';
import { getRepeatMode, subscribeRepeat } from '@/components/videojs/features/repeat';

const SINGLE: QueueSource = { type: 'single' };

/**
 * Translates library intent ("browse this track", "skip forward", "add to the
 * queue") into session and queue operations, and reports back when the playing
 * track changes. The only place that starts tracks or rebuilds the queue.
 */
export class PlaybackController {
    private readonly trackListeners = new Set<(track: TrackInfo | null) => void>();
    private lastActiveTrackId: string | null = null;
    private wasEnded = false;
    /** Where the browsed page was opened from, applied once its player is started. */
    private pendingStart: { source: QueueSource; index?: number } | null = null;
    private lastCanStep = { prev: false, next: false };

    constructor(
        private readonly library: Library,
        private readonly queue: PlaybackQueue,
        private readonly session: PlaybackSession,
    ) {
        this.session.onChange(() => this.onSessionChange());
        this.queue.onChange(() => this.publishCanStep());
        setSkipTarget(this);
        subscribeRepeat(() => this.applyRepeat());
    }

    /**
     * Entered a file page: show the track stopped, never touch playback.
     * `index` is the position in `source`, for playlists that hold a track twice.
     */
    browse(trackId: string, source?: QueueSource, index?: number): void {
        const track = this.library.getTrack(trackId);
        if (!track) return;
        this.pendingStart = source ? { source, index } : null;
        this.session.browse(this.toRequest(track));
    }

    /**
     * Explicit play request. From an album or playlist the queue is replaced by
     * that collection; a track on its own is played "now" and the rest of the
     * queue stays (see `PlaybackQueue.playNow`).
     */
    async activate(trackId: string, source?: QueueSource, index?: number): Promise<void> {
        const track = this.library.getTrack(trackId);
        if (!track) return;
        this.applyStart(track.id, source ?? SINGLE, index);
        await this.play(track);
    }

    /** Replaces the queue with an album or playlist and starts it from the top. */
    async playCollection(source: QueueSource, options: { shuffle?: boolean } = {}): Promise<void> {
        const ids = this.collection(source);
        if (!ids?.length) return;
        this.queue.replace(options.shuffle ? shuffled(ids) : ids, 0, source);
        const id = this.queue.currentId;
        if (id) await this.playId(id);
    }

    async step(direction: -1 | 1): Promise<void> {
        const id = this.queue.step(direction);
        if (id) await this.playId(id);
    }

    /** Plays any queue entry; the order is kept. */
    async jumpTo(uid: number): Promise<void> {
        const id = this.queue.jumpTo(uid);
        if (id) await this.playId(id);
    }

    /** Queues tracks right after the current one. */
    playNext(trackIds: readonly string[]): void {
        this.queue.insertNext(this.known(trackIds));
    }

    /** Queues tracks at the end. */
    enqueue(trackIds: readonly string[]): void {
        this.queue.append(this.known(trackIds));
    }

    /** Reorders what is still to come; indices are relative to it. */
    moveUpcoming(from: number, to: number): void {
        this.queue.moveUpcoming(from, to);
    }

    removeFromQueue(uid: number): void {
        this.queue.remove(uid);
    }

    shuffleUpcoming(): void {
        this.queue.shuffleUpcoming();
    }

    clearUpcoming(): void {
        this.queue.clearUpcoming();
    }

    /** Tracks of an album or playlist, for "add to queue" on its page. */
    collection(source: QueueSource): string[] | null {
        if (source.type === 'playlist') {
            const playlist = this.library.getPlaylist(source.id);
            if (playlist) return playlist.entries.map((entry) => entry.trackId);
        }
        if (source.type === 'album') {
            const album = this.library.getAlbum(source.id);
            if (album) return [...album.trackIds];
        }
        return null;
    }

    get canStep(): { prev: boolean; next: boolean } {
        return { prev: this.queue.hasPrev, next: this.queue.hasNext };
    }

    /** Fires whenever another track takes over playback. */
    onActiveTrack(listener: (track: TrackInfo | null) => void): void {
        this.trackListeners.add(listener);
    }

    /**
     * Puts the queue at `trackId`: a collection replaces it (a track opened on
     * its own never gains neighbours just because it belongs to an album),
     * anything else is played "now".
     */
    private applyStart(trackId: string, source: QueueSource, index?: number): void {
        const ids = this.collection(source);
        if (ids) {
            const at = index !== undefined && ids[index] === trackId ? index : ids.indexOf(trackId);
            if (at >= 0) {
                this.queue.replace(ids, at, source);
                return;
            }
        }
        if (this.queue.entries.length) this.queue.playNow(trackId);
        else this.queue.replace([trackId], 0, SINGLE);
    }

    private async playId(trackId: string): Promise<void> {
        const track = this.library.getTrack(trackId);
        if (track) await this.play(track);
    }

    private async play(track: TrackInfo): Promise<void> {
        this.applyRepeat();
        await this.session.start(this.toRequest(track));
    }

    private known(trackIds: readonly string[]): string[] {
        return trackIds.filter((id) => this.library.getTrack(id));
    }

    private onSessionChange(): void {
        const activeId = this.session.activeTrackId;
        if (activeId !== this.lastActiveTrackId) {
            this.lastActiveTrackId = activeId;
            const track = activeId ? this.library.getTrack(activeId) ?? null : null;
            // The user pressed play on a browsed page: the queue follows the same
            // rules as an explicit play request from that page.
            if (track && this.queue.currentId !== track.id) {
                const start = this.pendingStart;
                this.applyStart(track.id, start?.source ?? SINGLE, start?.index);
            }
            this.pendingStart = null;
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
        if (id) await this.playId(id);
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

    private toRequest(track: TrackInfo): PlaybackRequest {
        return {
            id: track.id,
            type: track.type,
            src: mediaUrl(track),
            title: track.title,
            artist: track.artist || track.filename,
            year: track.year,
            poster: track.hasArtwork ? artworkUrl(track.id, track.artworkTag) : FALLBACK_ART_DATA_URI,
            hasArtwork: track.hasArtwork,
            chapters: track.chapters ?? [],
            chaptersSrc: chaptersVttUrl(track),
            storyboardSrc: storyboardVttUrl(track),
            vr: track.type === 'video' ? parseVrFormat(track.filename) : null,
        };
    }
}
