import { applyPlaylistCover } from '../../api';
import { detailRowHtml } from '../../templates';
import { qs } from '../../utils/html';
import { renderHapticIcons } from '../haptic/icons';
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
    onClick: () => void;
}

export interface DetailViewOptions {
    allMedia(): TrackInfo[];
    openTrack(trackId: string, source: QueueSource, autoplay: boolean): void;
}

/** Header, track rows and play button of the playlist/album page. */
export class DetailView {
    private readonly list = qs<HTMLElement>('#detail-list');
    private readonly title = qs<HTMLElement>('#detail-title');
    private readonly subtitle = qs<HTMLElement>('#detail-subtitle');
    private readonly typeLabel = qs<HTMLElement>('#detail-type-label');
    private readonly playBtn = qs<HTMLButtonElement>('#btn-detail-play');
    private readonly cover = qs<HTMLImageElement>('#detail-cover');
    private readonly meta = qs<HTMLElement>('#detail-meta');
    private context: DetailContext | null = null;

    constructor(private readonly options: DetailViewOptions) {
        this.playBtn?.addEventListener('click', () => this.playFirst());
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
        this.renderRows(playlist.entries.map((entry) => ({
            order: entry.order,
            title: entry.title,
            artist: entry.artist,
            album: entry.album,
            onClick: () => this.options.openTrack(entry.trackId, source, true),
        })));
        if (this.playBtn) this.playBtn.disabled = !playlist.entries[0]?.trackId;
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
                onClick: () => this.options.openTrack(trackId, source, false),
            };
        }));
        if (this.playBtn) this.playBtn.disabled = !album.trackIds[0];
    }

    private playFirst(): void {
        const context = this.context;
        if (!context) return;
        if (context.type === 'playlist') {
            const firstTrackId = context.playlist.entries[0]?.trackId;
            if (firstTrackId) this.options.openTrack(firstTrackId, { type: 'playlist', id: context.playlist.id }, true);
        } else {
            const firstTrackId = context.album.trackIds[0];
            if (firstTrackId) this.options.openTrack(firstTrackId, { type: 'album', id: context.album.id }, true);
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
            tr.addEventListener('click', row.onClick);
            this.list.appendChild(tr);
        }
    }
}
