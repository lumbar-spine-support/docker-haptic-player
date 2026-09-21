import { qs, escapeHtml } from '../../utils/html';
import { fetchLibrary, artworkUrl } from '../../utils/api';
import { buildUrl, trackHref, detailHref } from '../../utils/routes';
import { renderHapticIcons } from '../../utils/hapticIcons';
import { FALLBACK_ART_DATA_URI, renderTrackArt } from '../../utils/artwork';
import { formatHoursMinutes } from '../../utils/formatTime';
import {
    albumMatchesActiveTags,
    albumMatchesHapticFilters,
    displayMediaTypeFilters,
    normalizeMediaTypeFilters,
    playlistMatchesActiveTags,
    playlistMatchesHapticFilters,
    trackMatchesActiveTags,
    trackMatchesHapticFilters,
} from '../../../shared/libraryFiltering';
import type { AlbumInfo, LibraryResponse, PlaylistInfo, TrackInfo, FunscriptType } from '../../../shared/types';
import {
    cardHtml,
    playlistCardHtml,
    trackRowHtml,
    sectionRowHtml,
    albumRowHtml,
    playlistRowHtml,
    emptyStateHtml,
    tagChipActiveHtml,
} from './templates';

type LibraryViewMode = 'grid' | 'list';

export interface LibraryCallbacks {
    openTrack(trackId: string): void;
    openAlbum(albumId: string): void;
    openPlaylist(playlistId: string): void;
    navigateTo(url: string): void;
    isLibraryRoute(): boolean;
    showLibrary(): void;
}

const VIEW_KEY = 'happy-view-mode';
const LIBRARY_FILTERS_KEY = 'happy-library-filters';
const CARD_GRID_CLASSES = 'col-6 col-sm-4 col-lg-2 col-xl-2';

export class Library {
    private readonly callbacks: LibraryCallbacks;

    // DOM elements
    private readonly libraryControls = qs<HTMLElement>('#library-controls');
    private readonly libraryViewToggle = qs<HTMLElement>('#library-view-toggle');
    private readonly grid = qs<HTMLElement>('#track-grid');
    private readonly table = qs<HTMLElement>('#track-table');
    private readonly list = qs<HTMLElement>('#track-list');
    private readonly btnGrid = qs<HTMLElement>('#btn-view-grid');
    private readonly btnList = qs<HTMLElement>('#btn-view-list');
    private readonly searchInput = qs<HTMLInputElement>('#search-input');
    private readonly activeTagsEl = qs<HTMLElement>('#active-tags');
    private readonly loading = qs<HTMLElement>('#loading');
    private readonly error = qs<HTMLElement>('#error-msg');
    private readonly navbarHomeLink = qs<HTMLAnchorElement>('#navbar-home');

    // State
    private tracks: TrackInfo[] = [];
    private videos: TrackInfo[] = [];
    private albums: AlbumInfo[] = [];
    private playlists: PlaylistInfo[] = [];
    private searchQuery = '';
    private activeTags: string[] = [];
    private sortField: 'title' | 'artist' | 'album' | 'year' | 'duration' | null = null;
    private sortAsc = true;
    private filterShowAlbums = true;
    private filterShowPlaylists = true;
    private filterShowTracks = true;
    private filterShowVideos = true;
    private filterShowHapticStroker = false;
    private filterShowHapticButtplug = false;
    private filterShowHapticVibrator = false;
    private filterShowHapticEstim = false;
    private filterShowHapticMachine = false;
    private currentViewMode: LibraryViewMode = 'grid';

    constructor(callbacks: LibraryCallbacks) {
        this.callbacks = callbacks;
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    async load(): Promise<void> {
        if (!this.grid || !this.list) return;
        try {
            const data: LibraryResponse = await fetchLibrary();
            this.tracks = data.tracks;
            this.videos = data.videos;
            this.albums = data.albums;
            this.playlists = data.playlists;
            this.render();
            this.loading?.remove();
        } catch (err) {
            this.loading?.remove();
            if (this.error) {
                this.error.textContent = `Failed to load library: ${String(err)}`;
                this.error.classList.remove('d-none');
            }
            console.error(err);
        }
    }

    render(): void {
        if (!this.grid || !this.list) return;
        this.grid.innerHTML = '';
        this.list.innerHTML = '';
        const isSearching = this.searchQuery.length > 0;

        const normalizedMediaFilters = normalizeMediaTypeFilters({
            albums: this.filterShowAlbums,
            playlists: this.filterShowPlaylists,
            tracks: this.filterShowTracks,
            videos: this.filterShowVideos,
        });
        const visibleAlbums = normalizedMediaFilters.albums ? this.getFilteredSortedAlbums() : [];
        const visiblePlaylists = normalizedMediaFilters.playlists ? this.getFilteredSortedPlaylists() : [];
        const tracks = normalizedMediaFilters.tracks ? this.getFilteredSortedTracks() : [];
        const videos = normalizedMediaFilters.videos ? this.getFilteredSortedVideos() : [];
        const tracksById = new Map(this.allMedia().map((track) => [track.id, track]));

        if (tracks.length === 0 && videos.length === 0 && visibleAlbums.length === 0 && visiblePlaylists.length === 0) {
            const hasActiveFilter = !normalizedMediaFilters.albums || !normalizedMediaFilters.playlists || !normalizedMediaFilters.tracks || !normalizedMediaFilters.videos;
            const msg = (isSearching || hasActiveFilter) ? 'No items match your search or filters.' : 'No media files found in the media directory.';
            this.grid.innerHTML = emptyStateHtml({ message: msg });
            return;
        }

        this.appendAlbumCards(visibleAlbums, tracksById);
        this.appendPlaylistCards(visiblePlaylists, tracksById);
        this.appendTrackCards(tracks, tracksById);
        this.appendVideoCards(videos, tracksById);

        if (visibleAlbums.length > 0) {
            this.list.appendChild(this.createSectionRow('Albums'));
            for (const album of visibleAlbums) {
                this.list.appendChild(this.createAlbumRow(album, tracksById));
            }
        }
        if (visiblePlaylists.length > 0) {
            this.list.appendChild(this.createSectionRow('Playlists'));
            for (const playlist of visiblePlaylists) {
                this.list.appendChild(this.createPlaylistRow(playlist, tracksById));
            }
        }
        if (tracks.length > 0) {
            this.list.appendChild(this.createSectionRow('Audio'));
            for (const track of tracks) {
                this.list.appendChild(this.createTrackRow(track));
            }
        }
        if (videos.length > 0) {
            this.list.appendChild(this.createSectionRow('Videos'));
            for (const video of videos) {
                this.list.appendChild(this.createTrackRow(video));
            }
        }
    }

    bindControls(): void {
        let viewMode: LibraryViewMode = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';

        const applyView = (mode: LibraryViewMode): void => {
            viewMode = mode;
            this.currentViewMode = mode;
            localStorage.setItem(VIEW_KEY, mode);

            this.grid?.classList.toggle('d-none', mode !== 'grid');
            this.table?.classList.toggle('d-none', mode !== 'list');
            this.btnGrid?.classList.toggle('active', mode === 'grid');
            this.btnList?.classList.toggle('active', mode === 'list');
        };

        this.btnGrid?.addEventListener('click', () => {
            applyView('grid');
            if (!this.callbacks.isLibraryRoute()) this.callbacks.navigateTo(buildUrl('library'));
        });
        this.btnList?.addEventListener('click', () => {
            applyView('list');
            if (!this.callbacks.isLibraryRoute()) this.callbacks.navigateTo(buildUrl('library'));
        });
        this.navbarHomeLink?.addEventListener('click', (event) => {
            event.preventDefault();
            this.callbacks.navigateTo(buildUrl('library'));
        });

        this.searchInput?.addEventListener('input', () => {
            this.searchQuery = this.searchInput?.value.trim() ?? '';
            this.renderTagSuggestions();
            this.render();
        });

        const storedFilters = this.loadLibraryFilters();
        const normalizedMediaFilters = normalizeMediaTypeFilters({
            albums: storedFilters.albums,
            playlists: storedFilters.playlists,
            tracks: storedFilters.tracks,
            videos: storedFilters.videos,
        });
        const visualMediaFilters = displayMediaTypeFilters(normalizedMediaFilters);
        this.filterShowAlbums = visualMediaFilters.albums;
        this.filterShowPlaylists = visualMediaFilters.playlists;
        this.filterShowTracks = visualMediaFilters.tracks;
        this.filterShowVideos = visualMediaFilters.videos;
        this.filterShowHapticStroker = storedFilters.hapticStroker;
        this.filterShowHapticButtplug = storedFilters.hapticButtplug;
        this.filterShowHapticVibrator = storedFilters.hapticVibrator;
        this.filterShowHapticEstim = storedFilters.hapticEstim;
        this.filterShowHapticMachine = storedFilters.hapticMachine;

        document.querySelectorAll<HTMLInputElement>('[data-filter-type]').forEach((cb) => {
            const type = cb.dataset.filterType;
            if (type === 'albums') cb.checked = visualMediaFilters.albums;
            else if (type === 'playlists') cb.checked = visualMediaFilters.playlists;
            else if (type === 'tracks') cb.checked = visualMediaFilters.tracks;
            else if (type === 'videos') cb.checked = visualMediaFilters.videos;
            else if (type === 'haptic-stroker') cb.checked = storedFilters.hapticStroker;
            else if (type === 'haptic-buttplug') cb.checked = storedFilters.hapticButtplug;
            else if (type === 'haptic-vibrator') cb.checked = storedFilters.hapticVibrator;
            else if (type === 'haptic-estim') cb.checked = storedFilters.hapticEstim;
            else if (type === 'haptic-machine') cb.checked = storedFilters.hapticMachine;

            cb.addEventListener('change', () => {
                if (type === 'albums') this.filterShowAlbums = cb.checked;
                else if (type === 'playlists') this.filterShowPlaylists = cb.checked;
                else if (type === 'tracks') this.filterShowTracks = cb.checked;
                else if (type === 'videos') this.filterShowVideos = cb.checked;
                else if (type === 'haptic-stroker') this.filterShowHapticStroker = cb.checked;
                else if (type === 'haptic-buttplug') this.filterShowHapticButtplug = cb.checked;
                else if (type === 'haptic-vibrator') this.filterShowHapticVibrator = cb.checked;
                else if (type === 'haptic-estim') this.filterShowHapticEstim = cb.checked;
                else if (type === 'haptic-machine') this.filterShowHapticMachine = cb.checked;
                this.saveLibraryFilters();
                this.render();
            });
        });

        document.querySelectorAll<HTMLElement>('[data-sort-field]').forEach((th) => {
            th.addEventListener('click', () => {
                const field = th.dataset.sortField as 'title' | 'artist' | 'album' | 'year' | 'duration';
                if (this.sortField === field) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortField = field;
                    this.sortAsc = true;
                }
                this.updateSortHeaders();
                this.render();
            });
        });

        applyView(viewMode);
    }

    renderActiveTags(): void {
        if (!this.activeTagsEl) return;
        const container = this.activeTagsEl;
        const label = container.querySelector('span.text-muted');
        container.innerHTML = '';
        if (label) container.appendChild(label);

        const q = this.searchQuery.trim();
        const suggested = q
            ? this.getAllTags()
                .filter((tag) =>
                    tag.toLowerCase().includes(q.toLowerCase()) &&
                    !this.activeTags.some((active) => active.toLowerCase() === tag.toLowerCase())
                )
                .slice(0, 10)
            : [];

        const showList = this.activeTags.length > 0 || suggested.length > 0;
        if (!showList) {
            container.classList.add('d-none');
            return;
        }
        container.classList.remove('d-none');

        for (const tag of this.activeTags) {
            const div = document.createElement('div');
            div.innerHTML = tagChipActiveHtml({ tag });
            const chip = div.firstElementChild as HTMLButtonElement;
            chip.title = `Remove filter: ${tag}`;
            chip.addEventListener('click', () => this.removeTag(tag));
            container.appendChild(chip);
        }

        for (const tag of suggested) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'tag-chip tag-chip-suggestion';
            chip.textContent = tag;
            chip.title = `Add tag: ${tag}`;
            chip.addEventListener('click', () => {
                if (this.searchInput) this.searchInput.value = '';
                this.searchQuery = '';
                this.addTag(tag);
            });
            container.appendChild(chip);
        }

        if (this.activeTags.length > 1) {
            const clearAll = document.createElement('button');
            clearAll.type = 'button';
            clearAll.className = 'tag-chip tag-chip-clear-all';
            clearAll.textContent = 'Clear all';
            clearAll.title = 'Clear all active tags';
            clearAll.addEventListener('click', () => {
                this.activeTags = [];
                this.callbacks.navigateTo(buildUrl('library'));
                this.renderActiveTags();
                this.render();
            });
            container.appendChild(clearAll);
        }
    }

    renderTagSuggestions(): void {
        this.renderActiveTags();
    }

    addTag(tag: string): void {
        if (!tag || this.activeTags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
        this.activeTags = [...this.activeTags, tag];
        const url = buildUrl('library', undefined, this.activeTags);
        history.pushState({}, '', url);
        this.callbacks.showLibrary();
    }

    setActiveTags(tags: string[]): void {
        this.activeTags = tags;
    }

    applyViewModeVisibility(): void {
        this.grid?.classList.toggle('d-none', this.currentViewMode !== 'grid');
        this.table?.classList.toggle('d-none', this.currentViewMode !== 'list');
    }

    setControlsVisible(visible: boolean): void {
        if (visible) this.libraryControls?.classList.remove('d-none');
        else this.libraryControls?.classList.add('d-none');
    }

    setViewToggleVisible(visible: boolean): void {
        if (visible) this.libraryViewToggle?.classList.remove('d-none');
        else this.libraryViewToggle?.classList.add('d-none');
    }

    setContentVisible(visible: boolean): void {
        const hidden = !visible ? 'd-none' : '';
        if (hidden) {
            this.grid?.classList.add(hidden);
            this.table?.classList.add(hidden);
        } else {
            this.grid?.classList.remove('d-none');
            this.table?.classList.remove('d-none');
            this.applyViewModeVisibility();
        }
    }

    allMedia(): TrackInfo[] {
        return [...this.tracks, ...this.videos];
    }

    getTrack(id: string): TrackInfo | undefined {
        return this.allMedia().find((t) => t.id === id);
    }

    getAlbum(id: string): AlbumInfo | undefined {
        return this.albums.find((a) => a.id === id);
    }

    getPlaylist(id: string): PlaylistInfo | undefined {
        return this.playlists.find((p) => p.id === id);
    }

    /** Finds the album containing the given track, if any. */
    findAlbumForTrack(trackId: string): AlbumInfo | undefined {
        return this.albums.find((album) => album.trackIds.includes(trackId));
    }

    /** Finds the playlist containing the given track, if any. */
    findPlaylistForTrack(trackId: string): PlaylistInfo | undefined {
        return this.playlists.find((playlist) => playlist.entries.some((entry) => entry.trackId === trackId));
    }

    get activeTags_readonly(): readonly string[] {
        return this.activeTags;
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private loadLibraryFilters(): {
        albums: boolean;
        playlists: boolean;
        tracks: boolean;
        videos: boolean;
        hapticStroker: boolean;
        hapticButtplug: boolean;
        hapticVibrator: boolean;
        hapticEstim: boolean;
        hapticMachine: boolean;
    } {
        const defaults = {
            albums: false,
            playlists: false,
            tracks: false,
            videos: false,
            hapticStroker: false,
            hapticButtplug: false,
            hapticVibrator: false,
            hapticEstim: false,
            hapticMachine: false,
        };
        const raw = localStorage.getItem(LIBRARY_FILTERS_KEY);
        if (!raw) return defaults;
        try {
            const parsed = JSON.parse(raw) as Partial<Record<'albums' | 'playlists' | 'tracks' | 'videos' | 'haptic-stroker' | 'haptic-buttplug' | 'haptic-vibrator' | 'haptic-estim' | 'haptic-machine' | 'hapticStroker' | 'hapticButtplug' | 'hapticVibrator' | 'hapticEstim' | 'hapticMachine', boolean>>;
            return {
                albums: typeof parsed.albums === 'boolean' ? parsed.albums : defaults.albums,
                playlists: typeof parsed.playlists === 'boolean' ? parsed.playlists : defaults.playlists,
                tracks: typeof parsed.tracks === 'boolean' ? parsed.tracks : defaults.tracks,
                videos: typeof parsed.videos === 'boolean' ? parsed.videos : defaults.videos,
                hapticStroker: typeof parsed['haptic-stroker'] === 'boolean' ? parsed['haptic-stroker'] : (typeof parsed.hapticStroker === 'boolean' ? parsed.hapticStroker : defaults.hapticStroker),
                hapticButtplug: typeof parsed['haptic-buttplug'] === 'boolean' ? parsed['haptic-buttplug'] : (typeof parsed.hapticButtplug === 'boolean' ? parsed.hapticButtplug : defaults.hapticButtplug),
                hapticVibrator: typeof parsed['haptic-vibrator'] === 'boolean' ? parsed['haptic-vibrator'] : (typeof parsed.hapticVibrator === 'boolean' ? parsed.hapticVibrator : defaults.hapticVibrator),
                hapticEstim: typeof parsed['haptic-estim'] === 'boolean' ? parsed['haptic-estim'] : (typeof parsed.hapticEstim === 'boolean' ? parsed.hapticEstim : defaults.hapticEstim),
                hapticMachine: typeof parsed['haptic-machine'] === 'boolean' ? parsed['haptic-machine'] : (typeof parsed.hapticMachine === 'boolean' ? parsed.hapticMachine : defaults.hapticMachine),
            };
        } catch {
            return defaults;
        }
    }

    private saveLibraryFilters(): void {
        localStorage.setItem(LIBRARY_FILTERS_KEY, JSON.stringify({
            albums: this.filterShowAlbums,
            playlists: this.filterShowPlaylists,
            tracks: this.filterShowTracks,
            videos: this.filterShowVideos,
            'haptic-stroker': this.filterShowHapticStroker,
            'haptic-buttplug': this.filterShowHapticButtplug,
            'haptic-vibrator': this.filterShowHapticVibrator,
            'haptic-estim': this.filterShowHapticEstim,
            'haptic-machine': this.filterShowHapticMachine,
        }));
    }

    private updateSortHeaders(): void {
        document.querySelectorAll<HTMLElement>('[data-sort-field]').forEach((th) => {
            const indicator = th.querySelector<HTMLElement>('.sort-indicator');
            if (!indicator) return;
            indicator.innerHTML = th.dataset.sortField === this.sortField
                ? `<i class="bi ${this.sortAsc ? 'bi-caret-up-fill' : 'bi-caret-down-fill'}"></i>`
                : '';
        });
    }

    private getFilteredSortedTracks(): TrackInfo[] {
        return this.filterSortTrackList(this.tracks);
    }

    private getFilteredSortedVideos(): TrackInfo[] {
        return this.filterSortTrackList(this.videos);
    }

    private filterSortTrackList(list: TrackInfo[]): TrackInfo[] {
        let tracks = list;
        const allowedHapticTypes: FunscriptType[] = [];
        if (this.filterShowHapticStroker) allowedHapticTypes.push('stroker');
        if (this.filterShowHapticButtplug) allowedHapticTypes.push('buttplug');
        if (this.filterShowHapticVibrator) allowedHapticTypes.push('vibrator');
        if (this.filterShowHapticEstim) allowedHapticTypes.push('estim');
        if (this.filterShowHapticMachine) allowedHapticTypes.push('machine');
        if (this.activeTags.length > 0) {
            tracks = tracks.filter((t) => trackMatchesActiveTags(t.tags, this.activeTags));
        }
        if (allowedHapticTypes.length > 0) {
            tracks = tracks.filter((t) => trackMatchesHapticFilters(t, allowedHapticTypes));
        }
        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            tracks = tracks.filter((t) =>
                t.title.toLowerCase().includes(q) ||
                t.artist.toLowerCase().includes(q) ||
                t.album.toLowerCase().includes(q)
            );
        }
        if (this.sortField) {
            const field = this.sortField;
            const asc = this.sortAsc;
            tracks = [...tracks].sort((a, b) => {
                const cmp = field === 'duration'
                    ? a.durationSeconds - b.durationSeconds
                    : a[field].localeCompare(b[field]);
                return asc ? cmp : -cmp;
            });
        }
        return tracks;
    }

    private getFilteredSortedAlbums(): AlbumInfo[] {
        let albums = this.albums;
        const tracksById = new Map(this.allMedia().map((track) => [track.id, track]));
        const allowedHapticTypes: FunscriptType[] = [];
        if (this.filterShowHapticStroker) allowedHapticTypes.push('stroker');
        if (this.filterShowHapticButtplug) allowedHapticTypes.push('buttplug');
        if (this.filterShowHapticVibrator) allowedHapticTypes.push('vibrator');
        if (this.filterShowHapticEstim) allowedHapticTypes.push('estim');
        if (this.filterShowHapticMachine) allowedHapticTypes.push('machine');
        if (this.activeTags.length > 0) {
            albums = albums.filter((album) => albumMatchesActiveTags(album, tracksById, this.activeTags));
        }
        if (allowedHapticTypes.length > 0) {
            albums = albums.filter((album) => albumMatchesHapticFilters(album, tracksById, allowedHapticTypes));
        }
        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            albums = albums.filter((a) =>
                a.title.toLowerCase().includes(q) || (a.artist ?? '').toLowerCase().includes(q)
            );
        }
        if (this.sortField) {
            const field = this.sortField;
            const asc = this.sortAsc;
            albums = [...albums].sort((a, b) => {
                let valA = '';
                let valB = '';
                if (field === 'title' || field === 'album') { valA = a.title; valB = b.title; }
                else if (field === 'artist') { valA = a.artist ?? ''; valB = b.artist ?? ''; }
                else if (field === 'year') { valA = a.year; valB = b.year; }
                else if (field === 'duration') {
                    const cmp = a.durationSeconds - b.durationSeconds;
                    return asc ? cmp : -cmp;
                }
                const cmp = valA.localeCompare(valB);
                return asc ? cmp : -cmp;
            });
        }
        return albums;
    }

    private getFilteredSortedPlaylists(): PlaylistInfo[] {
        let playlists = this.playlists;
        const tracksById = new Map(this.allMedia().map((track) => [track.id, track]));
        const allowedHapticTypes: FunscriptType[] = [];
        if (this.filterShowHapticStroker) allowedHapticTypes.push('stroker');
        if (this.filterShowHapticButtplug) allowedHapticTypes.push('buttplug');
        if (this.filterShowHapticVibrator) allowedHapticTypes.push('vibrator');
        if (this.filterShowHapticEstim) allowedHapticTypes.push('estim');
        if (this.filterShowHapticMachine) allowedHapticTypes.push('machine');
        if (this.activeTags.length > 0) {
            playlists = playlists.filter((playlist) => playlistMatchesActiveTags(playlist, tracksById, this.activeTags));
        }
        if (allowedHapticTypes.length > 0) {
            playlists = playlists.filter((playlist) => playlistMatchesHapticFilters(playlist, tracksById, allowedHapticTypes));
        }
        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            playlists = playlists.filter((p) =>
                p.name.toLowerCase().includes(q) ||
                p.filename.toLowerCase().includes(q) ||
                p.entries.some((entry) =>
                    entry.title.toLowerCase().includes(q) ||
                    entry.artist.toLowerCase().includes(q) ||
                    entry.album.toLowerCase().includes(q)
                )
            );
        }
        if (this.sortField) {
            const field = this.sortField;
            const asc = this.sortAsc;
            playlists = [...playlists].sort((a, b) => {
                let valA = '';
                let valB = '';
                if (field === 'title' || field === 'album') { valA = a.name; valB = b.name; }
                else if (field === 'artist') { valA = this.playlistArtists(a); valB = this.playlistArtists(b); }
                else if (field === 'duration') {
                    const cmp = a.durationSeconds - b.durationSeconds;
                    return asc ? cmp : -cmp;
                }
                const cmp = valA.localeCompare(valB);
                return asc ? cmp : -cmp;
            });
        }
        return playlists;
    }

    private getAllTags(): string[] {
        const set = new Set<string>();
        for (const track of this.allMedia()) {
            for (const tag of track.tags) set.add(tag);
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }

    private removeTag(tag: string): void {
        this.activeTags = this.activeTags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
        const url = buildUrl('library', undefined, this.activeTags);
        history.pushState({}, '', url);
        this.renderActiveTags();
        this.renderTagSuggestions();
        this.render();
    }

    // ── DOM builders ───────────────────────────────────────────────────────────

    private appendAlbumCards(albums: AlbumInfo[], tracksById: Map<string, TrackInfo>): void {
        if (!this.grid) return;
        for (const album of albums) {
            this.grid.appendChild(this.createAlbumCard(album, tracksById));
        }
    }

    private appendPlaylistCards(playlists: PlaylistInfo[], tracksById: Map<string, TrackInfo>): void {
        if (!this.grid) return;
        for (const playlist of playlists) {
            this.grid.appendChild(this.createPlaylistCard(playlist, tracksById));
        }
    }

    private appendTrackCards(tracks: TrackInfo[], tracksById: Map<string, TrackInfo>): void {
        if (!this.grid) return;
        for (const track of tracks) {
            this.grid.appendChild(this.createTrackCard(track, tracksById));
        }
    }

    private appendVideoCards(videos: TrackInfo[], tracksById: Map<string, TrackInfo>): void {
        if (!this.grid) return;
        for (const video of videos) {
            this.grid.appendChild(this.createVideoCard(video, tracksById));
        }
    }

    private createAlbumCard(album: AlbumInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const col = document.createElement('div');
        col.className = CARD_GRID_CLASSES;
        const artSrc = renderTrackArt(album.coverTrackId);
        const artist = `${album.artist || 'Unknown'}`;
        const meta = this.prependYear(this.buildCardMeta('album', album.durationSeconds), album.year);
        col.innerHTML = cardHtml({
            href: detailHref('album', album.id),
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            altText: 'Album art',
            title: album.title,
            artist,
            meta
        });
        col.querySelector('a')?.addEventListener('click', (event) => {
            event.preventDefault();
            this.callbacks.openAlbum(album.id);
        });
        return col;
    }

    private createTrackCard(track: TrackInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const col = document.createElement('div');
        col.className = CARD_GRID_CLASSES;
        const artSrc = track.hasArtwork ? artworkUrl(track.id) : FALLBACK_ART_DATA_URI;
        const artist = track.artist || 'Unknown';
        const meta = this.prependYear(this.buildCardMeta(track.type, track.durationSeconds), track.year);
        col.innerHTML = cardHtml({
            href: trackHref(track.id),
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            altText: 'Album art',
            title: track.title,
            artist: artist,
            meta
        });
        col.querySelector('a')?.addEventListener('click', (event) => {
            event.preventDefault();
            this.callbacks.openTrack(track.id);
        });
        return col;
    }

    private createVideoCard(video: TrackInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        return this.createTrackCard(video, tracksById);
    }

    private createPlaylistCard(playlist: PlaylistInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const firstTrack = tracksById.get(playlist.entries[0]?.trackId ?? '');
        const artSrc = firstTrack?.hasArtwork ? artworkUrl(firstTrack.id) : FALLBACK_ART_DATA_URI;
        const artists = this.playlistArtists(playlist);
        const meta = this.buildCardMeta('playlist', playlist.durationSeconds);
        const col = document.createElement('div');
        col.className = CARD_GRID_CLASSES;
        col.innerHTML = playlistCardHtml({
            href: detailHref('playlist', playlist.id),
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            name: playlist.name,
            artist: artists,
            meta,
        });
        col.querySelector('a')?.addEventListener('click', (event) => {
            event.preventDefault();
            this.callbacks.openPlaylist(playlist.id);
        });
        return col;
    }

    private createSectionRow(title: string): HTMLElement {
        const tr = document.createElement('tr');
        tr.innerHTML = sectionRowHtml({ title: escapeHtml(title) });
        return tr;
    }

    private createAlbumRow(album: AlbumInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => this.callbacks.openAlbum(album.id));
        tr.innerHTML = albumRowHtml({
            artSrc: renderTrackArt(album.coverTrackId),
            fallbackArt: FALLBACK_ART_DATA_URI,
            title: album.title,
            artist: album.artist || 'Unknown artist',
            year: album.year,
            duration: formatHoursMinutes(album.durationSeconds),
            hapticIcons: renderHapticIcons(this.albumFunscriptTypes(album, tracksById)),
        });
        return tr;
    }

    private createPlaylistRow(playlist: PlaylistInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const firstTrack = tracksById.get(playlist.entries[0]?.trackId ?? '');
        const artSrc = firstTrack?.hasArtwork ? artworkUrl(firstTrack.id) : FALLBACK_ART_DATA_URI;
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => this.callbacks.openPlaylist(playlist.id));
        tr.innerHTML = playlistRowHtml({
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            name: playlist.name,
            artists: this.playlistArtists(playlist),
            duration: formatHoursMinutes(playlist.durationSeconds),
        });
        return tr;
    }

    private createTrackRow(track: TrackInfo): HTMLElement {
        const artSrc = track.hasArtwork ? artworkUrl(track.id) : FALLBACK_ART_DATA_URI;
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => this.callbacks.openTrack(track.id));
        tr.innerHTML = trackRowHtml({
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            title: track.title,
            artist: track.artist,
            album: track.album,
            year: track.year,
            duration: formatHoursMinutes(track.durationSeconds),
            hapticIcons: renderHapticIcons(track.funscripts.map((f) => f.type)),
        });
        return tr;
    }

    private albumFunscriptTypes(album: AlbumInfo, tracksById: Map<string, TrackInfo>): FunscriptType[] {
        const types = new Set<FunscriptType>();
        for (const trackId of album.trackIds) {
            for (const f of tracksById.get(trackId)?.funscripts ?? []) types.add(f.type);
        }
        return Array.from(types);
    }

    private buildCardMeta(type: 'audio' | 'video' | 'album' | 'playlist', durationSeconds: number): string {
        return `${type.toUpperCase()} • ${formatHoursMinutes(durationSeconds)}`;
    }

    private prependYear(label: string, year: string): string {
        const trimmedLabel = label.trim();
        const trimmedYear = year.trim();
        if (!trimmedYear) return trimmedLabel;
        return trimmedLabel ? `${trimmedYear} • ${trimmedLabel}` : trimmedYear;
    }

    private playlistArtists(playlist: PlaylistInfo): string {
        const artists = Array.from(
            new Set(
                playlist.entries
                    .map((entry) => entry.artist.trim())
                    .filter((artist) => artist.length > 0)
            )
        );
        return artists.length > 0 ? artists.join(', ') : 'Unknown artist';
    }
}
