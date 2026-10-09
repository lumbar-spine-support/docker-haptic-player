import { applyPlaylistCover } from '../../api';
import { detailRowHtml } from '../../templates';
import { qs } from '../../utils/html';
import { renderHapticIcons } from '../haptic/icons';
import { bindFavoriteButton } from './favorites';
import { createQueueMenu } from './queueMenu';
import type { AlbumInfo, FunscriptInfo, PlaylistInfo, QueueSource, TrackInfo } from '../../../shared/types';

type DetailContext =
    | { type: 'playlist'; playlist: PlaylistInfo }
    | { type: 'album'; album: AlbumInfo };

interface DetailRow {
    order: number;
    title: string;
    artist: string;
    album: string;
    funscripts?: FunscriptInfo[];
    trackId: string;
    onClick: () => void;
}

export interface DetailViewOptions {
    allMedia(): TrackInfo[];
    /** `index` is the row's position in `source`, so a playlist holding a track twice starts at that row. */
    openTrack(trackId: string, source: QueueSource, autoplay: boolean, index: number): void;
    playCollection(source: QueueSource, shuffle: boolean): void;
    enqueue(trackIds: string[]): void;
}

/** Header, track rows and play/shuffle/queue buttons of the playlist/album page. */
export class DetailView {
    private readonly list = qs<HTMLElement>('#detail-list');
    private readonly title = qs<HTMLElement>('#detail-title');
    private readonly subtitle = qs<HTMLElement>('#detail-subtitle');
    private readonly typeLabel = qs<HTMLElement>('#detail-type-label');
    private readonly playBtn = qs<HTMLButtonElement>('#btn-detail-play');
    private readonly shuffleBtn = qs<HTMLButtonElement>('#btn-detail-shuffle');
    private readonly enqueueBtn = qs<HTMLButtonElement>('#btn-detail-enqueue');
    private readonly cover = qs<HTMLImageElement>('#detail-cover');
    private readonly meta = qs<HTMLElement>('#detail-meta');
    private readonly favoriteBtn = qs<HTMLButtonElement>('#btn-detail-favorite');
    private context: DetailContext | null = null;

    constructor(private readonly options: DetailViewOptions) {
        this.playBtn?.addEventListener('click', () => this.play(false));
        this.shuffleBtn?.addEventListener('click', () => this.play(true));
        this.enqueueBtn?.addEventListener('click', () => {
            const ids = this.trackIds();
            if (ids.length) this.options.enqueue(ids);
        });
    }

    clear(): void {
        this.context = null;
    }

    showPlaylist(playlist: PlaylistInfo): void {
        this.context = { type: 'playlist', playlist };
        const source: QueueSource = { type: 'playlist', id: playlist.id };
        const artists = [...new Set(playlist.entries.map((entry) => entry.artist).filter(Boolean))];
        this.renderHeader(
            'Playlist',
            playlist.name,
            artists.join(', ') || 'Unknown artist',
            `${playlist.entries.length} media`,
            playlist.entries.map((entry) => entry.trackId),
        );
        this.renderRows(playlist.entries.map((entry, index) => ({
            order: entry.order,
            title: entry.title,
            artist: entry.artist,
            album: entry.album,
            trackId: entry.trackId,
            onClick: () => this.options.openTrack(entry.trackId, source, true, index),
        })));
        this.setButtonsEnabled(playlist.entries.length > 0);
        if (this.favoriteBtn) bindFavoriteButton(this.favoriteBtn, playlist);
    }

    showAlbum(album: AlbumInfo): void {
        this.context = { type: 'album', album };
        const source: QueueSource = { type: 'album', id: album.id };
        const media = this.options.allMedia();
        this.renderHeader('Album', album.title, album.artist || 'Unknown artist', '', [album.coverTrackId]);
        this.renderRows(album.trackIds.map((trackId, index) => {
            const track = media.find((item) => item.id === trackId);
            return {
                order: index + 1,
                title: track?.title ?? trackId,
                artist: track?.artist ?? '',
                album: track?.album ?? '',
                funscripts: track?.funscripts ?? [],
                trackId,
                onClick: () => this.options.openTrack(trackId, source, false, index),
            };
        }));
        this.setButtonsEnabled(album.trackIds.length > 0);
        // Albums are grouped client-side; Jellyfin has no item to mark.
        if (this.favoriteBtn) bindFavoriteButton(this.favoriteBtn, null);
    }

    private get source(): QueueSource | null {
        const context = this.context;
        if (!context) return null;
        return context.type === 'playlist'
            ? { type: 'playlist', id: context.playlist.id }
            : { type: 'album', id: context.album.id };
    }

    private trackIds(): string[] {
        const context = this.context;
        if (!context) return [];
        return context.type === 'playlist' ? context.playlist.entries.map((entry) => entry.trackId) : [...context.album.trackIds];
    }

    private play(shuffle: boolean): void {
        const source = this.source;
        if (source) this.options.playCollection(source, shuffle);
    }

    private setButtonsEnabled(enabled: boolean): void {
        for (const button of [this.playBtn, this.shuffleBtn, this.enqueueBtn]) {
            if (button) button.disabled = !enabled;
        }
    }

    private renderHeader(type: string, title: string, subtitle: string, meta: string, coverTrackIds: (string | null | undefined)[]): void {
        if (this.typeLabel) this.typeLabel.textContent = type;
        if (this.title) this.title.textContent = title;
        if (this.subtitle) this.subtitle.textContent = subtitle;
        if (this.meta) this.meta.textContent = meta;
        if (this.cover) {
            const media = this.options.allMedia();
            applyPlaylistCover(this.cover, coverTrackIds.map((id) => media.find((item) => item.id === id)));
            this.cover.style.display = '';
        }
    }

    private renderRows(rows: DetailRow[]): void {
        if (!this.list) return;
        this.list.innerHTML = '';
        for (const row of rows) {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.innerHTML = detailRowHtml({
                order: String(row.order),
                title: row.title,
                artist: row.artist,
                album: row.album,
                hapticIcons: row.funscripts?.length ? renderHapticIcons(row.funscripts.map((f) => f.type)) : '',
            });
            const actions = document.createElement('td');
            actions.className = 'align-middle text-end pe-2 favorite-cell';
            actions.appendChild(createQueueMenu(() => [row.trackId], row.title));
            tr.appendChild(actions);
            tr.addEventListener('click', row.onClick);
            this.list.appendChild(tr);
        }
    }
}
