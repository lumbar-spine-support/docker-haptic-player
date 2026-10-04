import { qs } from '../../utils/html';
import { fetchLibrary, FALLBACK_ART_DATA_URI, applyPlaylistCover, renderTrackArt } from '../../api';
import { buildUrl, trackHref, detailHref } from '../../router';
import { renderHapticIcons, ROLE_ICON_CLASSES, ROLE_LABELS } from '../haptic/icons';
import { formatHoursMinutes } from '../../utils/formatTime';
import { classifyArtAspect } from '../../utils/artAspect';
import {
    albumMatchesActiveTags,
    albumMatchesHapticFilters,
    artistTagValue,
    countMediaMatches,
    filterAvailableTags,
    isArtistTag,
    LIBRARY_SORT_FIELDS,
    makeArtistTag,
    playlistMatchesActiveTags,
    playlistMatchesHapticFilters,
    sortLibraryItems,
    trackMatchesActiveTags,
    trackMatchesHapticFilters,
    type LibrarySortField,
    type SortableLibraryItem,
} from '../../../shared/libraryFiltering';
import type { AlbumInfo, LibraryResponse, PlaylistInfo, TrackInfo, FunscriptType } from '../../../shared/types';
import {
    cardHtml,
    mediaRowHtml,
    emptyStateHtml,
    tagChipActiveHtml,
    tagChipArtistActiveHtml,
} from './templates';

type LibraryViewMode = 'grid' | 'list' | 'tags';

/** A single media entry, rendered as a card in grid view and a row in list view. */
interface LibraryRow extends SortableLibraryItem {
    buildCard(): HTMLElement;
    buildRow(): HTMLElement;
}

interface FilterOption {
    key: string;
    label: string;
    icon: string;
}

const MEDIA_FILTERS = [
    { key: 'albums', label: 'Albums', icon: 'bi bi-vinyl' },
    { key: 'tracks', label: 'Audio', icon: 'bi bi-music-note' },
    { key: 'playlists', label: 'Playlists', icon: 'bi bi-music-note-list' },
    { key: 'videos', label: 'Videos', icon: 'bi bi-play-btn' },
] as const satisfies readonly FilterOption[];
type MediaFilterKey = typeof MEDIA_FILTERS[number]['key'];

const HAPTIC_TYPES = Object.keys(ROLE_LABELS) as FunscriptType[];

const SORT_LABELS: Record<LibrarySortField, string> = {
    title: 'Title',
    artist: 'Artist',
    year: 'Year',
    duration: 'Duration',
    type: 'Type',
};

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
const LIBRARY_SORT_KEY = 'happy-library-sort';
const CARD_SQUARE_GRID_CLASSES = 'col-6 col-sm-3 col-lg-2 col-xl-2 col-xxl-2';
const CARD_LANDSCAPE_GRID_CLASSES = 'col-12 col-sm-6 col-lg-4 col-xl-4 col-xxl-4';
const RENDER_BATCH_SIZE = 48;

export class Library {
    private readonly callbacks: LibraryCallbacks;

    // DOM elements
    private readonly libraryControls = qs<HTMLElement>('#library-controls');
    private readonly libraryViewToggle = qs<HTMLElement>('#library-view-toggle');
    private readonly grid = qs<HTMLElement>('#track-grid');
    private readonly table = qs<HTMLElement>('#track-table');
    private readonly list = qs<HTMLElement>('#track-list');
    private batchObservers: IntersectionObserver[] = [];
    private readonly btnGrid = qs<HTMLElement>('#btn-view-grid');
    private readonly btnList = qs<HTMLElement>('#btn-view-list');
    private readonly btnTags = qs<HTMLElement>('#btn-view-tags');
    private readonly tagView = qs<HTMLElement>('#tag-view');
    private readonly tagViewSelected = qs<HTMLElement>('#tag-view-selected');
    private readonly tagViewAvailable = qs<HTMLElement>('#tag-view-available');
    private readonly tagViewCounts = qs<HTMLElement>('#tag-view-counts');
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
    private sortField: LibrarySortField = 'title';
    private sortAsc = true;
    /** Empty means every media type is shown. */
    private mediaFilters = new Set<MediaFilterKey>();
    /** Items must provide every selected haptic type; empty means no haptic filter. */
    private hapticFilters = new Set<FunscriptType>();
    private currentViewMode: LibraryViewMode = 'grid';
    private loaded = false;
    private forceSquareArtwork = false;

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
            this.loaded = true;
            this.applyViewModeVisibility();
            this.renderActiveTags();
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
        this.batchObservers.forEach((o) => o.disconnect());
        this.batchObservers = [];
        this.grid.innerHTML = '';
        this.list.innerHTML = '';
        const isSearching = this.searchQuery.length > 0;

        const shows = (key: MediaFilterKey): boolean => this.mediaFilters.size === 0 || this.mediaFilters.has(key);
        const visibleAlbums = shows('albums') ? this.getFilteredAlbums() : [];
        const visiblePlaylists = shows('playlists') ? this.getFilteredPlaylists() : [];
        const tracks = shows('tracks') ? this.filterTrackList(this.tracks) : [];
        const videos = shows('videos') ? this.filterTrackList(this.videos) : [];
        const tracksById = new Map(this.allMedia().map((track) => [track.id, track]));

        if (tracks.length === 0 && videos.length === 0 && visibleAlbums.length === 0 && visiblePlaylists.length === 0) {
            const hasActiveFilter = this.mediaFilters.size > 0 || this.hapticFilters.size > 0;
            const msg = (isSearching || hasActiveFilter) ? 'No items match your search or filters.' : 'No media files found in the media directory.';
            this.grid.innerHTML = emptyStateHtml({ message: msg });
            return;
        }

        const rows: LibraryRow[] = [
            ...visibleAlbums.map((album) => ({
                typeLabel: 'Album',
                title: album.title,
                artist: album.artist ?? '',
                year: album.year,
                durationSeconds: album.durationSeconds,
                buildCard: () => this.createAlbumCard(album, tracksById),
                buildRow: () => this.createAlbumRow(album, tracksById),
            })),
            ...visiblePlaylists.map((playlist) => ({
                typeLabel: 'Playlist',
                title: playlist.name,
                artist: this.playlistArtists(playlist),
                year: '',
                durationSeconds: playlist.durationSeconds,
                buildCard: () => this.createPlaylistCard(playlist, tracksById),
                buildRow: () => this.createPlaylistRow(playlist, tracksById),
            })),
            ...[...tracks, ...videos].map((track) => ({
                typeLabel: track.type === 'video' ? 'Video' : 'Audio',
                title: track.title,
                artist: track.artist,
                year: track.year ?? '',
                durationSeconds: track.durationSeconds,
                buildCard: () => this.createTrackCard(track),
                buildRow: () => this.createTrackRow(track),
            })),
        ];

        const sorted = sortLibraryItems(rows, this.sortField, this.sortAsc);
        this.appendInBatches(this.grid, sorted.map((row) => row.buildCard));
        this.appendInBatches(this.list, sorted.map((row) => row.buildRow));
    }

    private appendInBatches(container: HTMLElement, builders: Array<() => HTMLElement>): void {
        const isTable = container.tagName === 'TBODY';
        const sentinel = document.createElement(isTable ? 'tr' : 'div');
        sentinel.setAttribute('aria-hidden', 'true');
        sentinel.style.height = '1px';
        if (isTable) sentinel.appendChild(document.createElement('td'));
        else sentinel.className = 'col-12 p-0';
        container.appendChild(sentinel);

        let next = 0;
        const observer = new IntersectionObserver((entries) => {
            if (isTable && this.currentViewMode !== 'list') return;
            if (entries.some((e) => e.isIntersecting)) appendBatch();
        }, { rootMargin: '800px' });
        const appendBatch = (): void => {
            const frag = document.createDocumentFragment();
            const end = Math.min(next + RENDER_BATCH_SIZE, builders.length);
            for (; next < end; next++) frag.appendChild(builders[next]());
            container.insertBefore(frag, sentinel);
            observer.unobserve(sentinel);
            if (next >= builders.length) {
                observer.disconnect();
                sentinel.remove();
            } else {
                // Re-observing fires a fresh callback if the sentinel is still in view.
                observer.observe(sentinel);
            }
        };
        this.batchObservers.push(observer);
        appendBatch();
    }

    bindControls(): void {
        const storedView = localStorage.getItem(VIEW_KEY);
        const viewMode: LibraryViewMode = storedView === 'list' || storedView === 'tags' ? storedView : 'grid';

        const applyView = (mode: LibraryViewMode): void => {
            // Row batching pauses outside list view; re-render to resume it.
            const resumeRows = mode === 'list' && this.currentViewMode !== 'list' && this.loaded;
            this.currentViewMode = mode;
            localStorage.setItem(VIEW_KEY, mode);
            if (resumeRows) this.render();

            this.applyViewModeVisibility();
            this.btnGrid?.classList.toggle('active', mode === 'grid');
            this.btnList?.classList.toggle('active', mode === 'list');
            this.btnTags?.classList.toggle('active', mode === 'tags');
            this.renderActiveTags();
        };

        this.btnGrid?.addEventListener('click', () => {
            applyView('grid');
            if (!this.callbacks.isLibraryRoute()) this.callbacks.navigateTo(buildUrl('library'));
        });
        this.btnList?.addEventListener('click', () => {
            applyView('list');
            if (!this.callbacks.isLibraryRoute()) this.callbacks.navigateTo(buildUrl('library'));
        });
        this.btnTags?.addEventListener('click', () => {
            applyView('tags');
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

        this.loadLibraryFilters();
        this.bindFilterMenu(
            'media',
            MEDIA_FILTERS,
            this.mediaFilters as Set<string>,
            (key) => key,
            'All media',
        );
        this.bindFilterMenu(
            'haptic',
            HAPTIC_TYPES.map((type) => ({ key: type, label: ROLE_LABELS[type], icon: `bi device-role-icon ${ROLE_ICON_CLASSES[type]}` })),
            this.hapticFilters as Set<string>,
            (key) => `haptic-${key}`,
            'Any haptics',
        );
        this.bindSortControls();

        applyView(viewMode);
    }

    renderActiveTags(): void {
        if (this.currentViewMode === 'tags') {
            this.renderTagView();
            return;
        }
        if (!this.activeTagsEl) return;
        const container = this.activeTagsEl;
        const label = container.querySelector('span.text-muted');
        container.innerHTML = '';
        if (label) container.appendChild(label);

        const q = this.searchQuery.trim();
        const suggested = q ? this.getSuggestions(q) : [];

        const showList = this.activeTags.length > 0 || suggested.length > 0;
        if (!showList) {
            container.classList.add('d-none');
            return;
        }
        container.classList.remove('d-none');

        for (const tag of this.activeTags) {
            const div = document.createElement('div');
            const artist = isArtistTag(tag) ? artistTagValue(tag) : null;
            div.innerHTML = artist === null ? tagChipActiveHtml({ tag }) : tagChipArtistActiveHtml({ artist });
            const chip = div.firstElementChild as HTMLButtonElement;
            chip.title = artist === null ? `Remove filter: ${tag}` : `Remove artist filter: ${artist}`;
            chip.addEventListener('click', () => this.removeTag(tag));
            container.appendChild(chip);
        }

        for (const suggestion of suggested) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'tag-chip tag-chip-suggestion';
            if (suggestion.artist) {
                const icon = document.createElement('i');
                icon.className = 'bi bi-person-fill';
                icon.setAttribute('aria-hidden', 'true');
                chip.appendChild(icon);
                chip.appendChild(document.createTextNode(` ${suggestion.label}`));
                chip.title = `Add artist filter: ${suggestion.label}`;
            } else {
                chip.textContent = suggestion.label;
                chip.title = `Add tag: ${suggestion.label}`;
            }
            chip.addEventListener('click', () => {
                if (this.searchInput) this.searchInput.value = '';
                this.searchQuery = '';
                this.addTag(suggestion.value);
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

    private renderTagView(): void {
        if (!this.tagViewSelected || !this.tagViewAvailable) return;
        this.tagViewSelected.innerHTML = '';
        this.tagViewAvailable.innerHTML = '';

        const selected = this.activeTags.filter((tag) => !isArtistTag(tag));
        for (const tag of selected) {
            const div = document.createElement('div');
            div.innerHTML = tagChipActiveHtml({ tag });
            const chip = div.firstElementChild as HTMLButtonElement;
            chip.title = `Remove filter: ${tag}`;
            chip.addEventListener('click', () => this.removeTag(tag));
            this.tagViewSelected.appendChild(chip);
        }
        if (selected.length > 1) {
            const clearAll = document.createElement('button');
            clearAll.type = 'button';
            clearAll.className = 'tag-chip tag-chip-clear-all';
            clearAll.textContent = 'Clear all';
            clearAll.title = 'Clear all active tags';
            clearAll.addEventListener('click', () => {
                this.activeTags = this.activeTags.filter((tag) => isArtistTag(tag));
                this.callbacks.navigateTo(buildUrl('library', undefined, this.activeTags));
                this.renderActiveTags();
                this.render();
            });
            this.tagViewSelected.appendChild(clearAll);
        }
        this.tagViewSelected.classList.toggle('d-none', selected.length === 0);

        for (const tag of filterAvailableTags(this.getAllTags(), this.activeTags, this.searchQuery)) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'tag-chip tag-chip-suggestion';
            chip.textContent = tag;
            chip.title = `Add tag: ${tag}`;
            chip.addEventListener('click', () => this.addTag(tag));
            this.tagViewAvailable.appendChild(chip);
        }

        const counts = countMediaMatches(
            { tracks: this.tracks, videos: this.videos, albums: this.albums, playlists: this.playlists },
            this.activeTags,
        );
        this.tagViewCounts?.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
            el.textContent = String(counts[el.dataset.count as keyof typeof counts] ?? 0);
        });
    }

    addTag(tag: string): void {
        if (!tag) return;
        if (!this.activeTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
            this.activeTags = [...this.activeTags, tag];
        }
        const url = buildUrl('library', undefined, this.activeTags);
        history.pushState({}, '', url);
        this.callbacks.showLibrary();
    }

    setForceSquareArtwork(force: boolean): void {
        this.forceSquareArtwork = force;
    }

    setActiveTags(tags: string[]): void {
        this.activeTags = tags;
    }

    applyViewModeVisibility(): void {
        const mode = this.currentViewMode;
        const tags = mode === 'tags';
        this.grid?.classList.toggle('d-none', !this.loaded || mode !== 'grid');
        this.table?.classList.toggle('d-none', !this.loaded || mode !== 'list');
        this.list?.classList.toggle('rows-collapsed', mode !== 'list');
        this.tagView?.classList.toggle('d-none', !this.loaded || !tags);
        this.tagViewCounts?.classList.toggle('d-none', !this.loaded || !tags);
        document.querySelectorAll<HTMLElement>('.library-filter-group').forEach((el) => el.classList.toggle('d-none', tags));
        if (tags) this.activeTagsEl?.classList.add('d-none');
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

    /** Stored as `{ [data-filter-type]: boolean }` so older saved filters keep working. */
    private loadLibraryFilters(): void {
        let parsed: Record<string, unknown> = {};
        try {
            parsed = JSON.parse(localStorage.getItem(LIBRARY_FILTERS_KEY) ?? '{}') as Record<string, unknown>;
        } catch { /* fall back to no filters */ }
        for (const { key } of MEDIA_FILTERS) if (parsed[key] === true) this.mediaFilters.add(key);
        for (const type of HAPTIC_TYPES) if (parsed[`haptic-${type}`] === true) this.hapticFilters.add(type);
        // Every media type selected is the same as none; keep the menu showing "All".
        if (this.mediaFilters.size === MEDIA_FILTERS.length) this.mediaFilters.clear();

        try {
            const sort = JSON.parse(localStorage.getItem(LIBRARY_SORT_KEY) ?? '{}') as { field?: unknown; asc?: unknown };
            if (LIBRARY_SORT_FIELDS.includes(sort.field as LibrarySortField)) this.sortField = sort.field as LibrarySortField;
            if (typeof sort.asc === 'boolean') this.sortAsc = sort.asc;
        } catch { /* keep default sort */ }
    }

    private saveLibraryFilters(): void {
        const stored: Record<string, boolean> = {};
        for (const { key } of MEDIA_FILTERS) stored[key] = this.mediaFilters.has(key);
        for (const type of HAPTIC_TYPES) stored[`haptic-${type}`] = this.hapticFilters.has(type);
        localStorage.setItem(LIBRARY_FILTERS_KEY, JSON.stringify(stored));
        localStorage.setItem(LIBRARY_SORT_KEY, JSON.stringify({ field: this.sortField, asc: this.sortAsc }));
    }

    /** Fills a filter dropdown with one checkbox per option plus a "show all" reset. */
    private bindFilterMenu(
        name: string,
        options: readonly FilterOption[],
        selected: Set<string>,
        filterType: (key: string) => string,
        allLabel: string,
    ): void {
        const menu = document.querySelector<HTMLElement>(`[data-filter-menu="${name}"]`);
        const summary = menu?.parentElement?.querySelector<HTMLElement>('[data-filter-summary]');
        if (!menu) return;
        menu.innerHTML = '';

        const inputs: HTMLInputElement[] = [];
        const updateSummary = (): void => {
            if (!summary) return;
            const chosen = options.filter((o) => selected.has(o.key));
            if (chosen.length === 0) summary.textContent = allLabel;
            else if (chosen.length === 1) summary.textContent = chosen[0].label;
            else summary.textContent = `${chosen.length} selected`;
            menu.parentElement?.querySelector('.dropdown-toggle')?.classList.toggle('active', chosen.length > 0);
        };
        const changed = (): void => {
            if (name === 'media' && selected.size === options.length) {
                selected.clear();
                inputs.forEach((input) => { input.checked = false; });
            }
            updateSummary();
            this.saveLibraryFilters();
            this.render();
        };

        for (const option of options) {
            const li = document.createElement('li');
            const label = document.createElement('label');
            label.className = 'dropdown-item d-flex align-items-center gap-2';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'form-check-input m-0';
            input.dataset.filterType = filterType(option.key);
            input.checked = selected.has(option.key);
            input.addEventListener('change', () => {
                if (input.checked) selected.add(option.key);
                else selected.delete(option.key);
                changed();
            });
            const icon = document.createElement('i');
            icon.className = option.icon;
            icon.setAttribute('aria-hidden', 'true');
            label.append(input, icon, document.createTextNode(option.label));
            li.appendChild(label);
            menu.appendChild(li);
            inputs.push(input);
        }

        const divider = document.createElement('li');
        divider.innerHTML = '<hr class="dropdown-divider">';
        const resetItem = document.createElement('li');
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'dropdown-item';
        reset.textContent = allLabel;
        reset.addEventListener('click', () => {
            selected.clear();
            inputs.forEach((input) => { input.checked = false; });
            changed();
        });
        resetItem.appendChild(reset);
        menu.append(divider, resetItem);
        updateSummary();
    }

    private bindSortControls(): void {
        const menu = document.querySelector<HTMLElement>('#sort-field-menu');
        const setSort = (field: LibrarySortField, asc: boolean): void => {
            this.sortField = field;
            this.sortAsc = asc;
            this.saveLibraryFilters();
            this.updateSortControls();
            this.render();
        };

        if (menu) {
            menu.innerHTML = '';
            for (const field of LIBRARY_SORT_FIELDS) {
                const li = document.createElement('li');
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'dropdown-item';
                item.dataset.sortOption = field;
                item.textContent = SORT_LABELS[field];
                item.addEventListener('click', () => setSort(field, this.sortField === field ? this.sortAsc : true));
                li.appendChild(item);
                menu.appendChild(li);
            }
        }
        document.querySelector('#sort-direction')?.addEventListener('click', () => setSort(this.sortField, !this.sortAsc));

        document.querySelectorAll<HTMLElement>('[data-sort-field]').forEach((th) => {
            th.addEventListener('click', () => {
                const field = th.dataset.sortField as LibrarySortField;
                setSort(field, this.sortField === field ? !this.sortAsc : true);
            });
        });
        this.updateSortControls();
    }

    private updateSortControls(): void {
        const label = document.querySelector<HTMLElement>('#sort-field-label');
        if (label) label.textContent = SORT_LABELS[this.sortField];
        document.querySelectorAll<HTMLElement>('[data-sort-option]').forEach((item) => {
            item.classList.toggle('active', item.dataset.sortOption === this.sortField);
        });
        const direction = document.querySelector<HTMLElement>('#sort-direction');
        if (direction) {
            const text = this.sortAsc ? 'Ascending' : 'Descending';
            direction.title = text;
            direction.setAttribute('aria-label', text);
            direction.innerHTML = `<i class="bi ${this.sortAsc ? 'bi-sort-up' : 'bi-sort-down'}" aria-hidden="true"></i>`;
        }
        document.querySelectorAll<HTMLElement>('[data-sort-field]').forEach((th) => {
            const indicator = th.querySelector<HTMLElement>(':scope > .sort-indicator');
            if (!indicator) return;
            indicator.innerHTML = th.dataset.sortField === this.sortField
                ? `<i class="bi ${this.sortAsc ? 'bi-caret-up-fill' : 'bi-caret-down-fill'}"></i>`
                : '';
        });
    }

    private filterTrackList(list: TrackInfo[]): TrackInfo[] {
        let tracks = list;
        const allowedHapticTypes = [...this.hapticFilters];
        if (this.activeTags.length > 0) {
            tracks = tracks.filter((t) => trackMatchesActiveTags(t.tags, this.activeTags, t.artist));
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
        return tracks;
    }

    private getFilteredAlbums(): AlbumInfo[] {
        let albums = this.albums;
        const tracksById = new Map(this.allMedia().map((track) => [track.id, track]));
        const allowedHapticTypes = [...this.hapticFilters];
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
        return albums;
    }

    private getFilteredPlaylists(): PlaylistInfo[] {
        let playlists = this.playlists;
        const tracksById = new Map(this.allMedia().map((track) => [track.id, track]));
        const allowedHapticTypes = [...this.hapticFilters];
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
        return playlists;
    }

    private getAllTags(): string[] {
        const set = new Set<string>();
        for (const track of this.allMedia()) {
            for (const tag of track.tags) set.add(tag);
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }

    private getAllArtists(): string[] {
        const byLower = new Map<string, string>();
        const add = (artist: string): void => {
            const trimmed = artist.trim();
            if (!trimmed) return;
            const key = trimmed.toLowerCase();
            if (!byLower.has(key)) byLower.set(key, trimmed);
        };
        for (const track of this.allMedia()) add(track.artist ?? '');
        for (const album of this.albums) add(album.artist ?? '');
        for (const playlist of this.playlists) {
            for (const entry of playlist.entries) add(entry.artist ?? '');
        }
        return [...byLower.values()].sort((a, b) => a.localeCompare(b));
    }

    /** Artist suggestions are listed before tag suggestions. */
    private getSuggestions(query: string): { label: string; value: string; artist: boolean }[] {
        const q = query.toLowerCase();
        const isActive = (value: string): boolean =>
            this.activeTags.some((active) => active.toLowerCase() === value.toLowerCase());

        const artists = this.getAllArtists()
            .filter((artist) => artist.toLowerCase().includes(q) && !isActive(makeArtistTag(artist)))
            .map((artist) => ({ label: artist, value: makeArtistTag(artist), artist: true }));

        const tags = this.getAllTags()
            .filter((tag) => tag.toLowerCase().includes(q) && !isActive(tag))
            .map((tag) => ({ label: tag, value: tag, artist: false }));

        return [...artists, ...tags].slice(0, 10);
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

    private createAlbumCard(album: AlbumInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const col = document.createElement('div');
        col.className = CARD_SQUARE_GRID_CLASSES;
        const artSrc = renderTrackArt(album.coverTrackId ? tracksById.get(album.coverTrackId) : null);
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
        this.applyCardAspect(col);
        return col;
    }

    private createTrackCard(track: TrackInfo): HTMLElement {
        const col = document.createElement('div');
        col.className = CARD_SQUARE_GRID_CLASSES;
        const artSrc = renderTrackArt(track);
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
        this.applyCardAspect(col);
        return col;
    }

    /** Widens (landscape) or heightens (portrait) the card once its artwork aspect is known. */
    private applyCardAspect(col: HTMLElement): void {
        if (this.forceSquareArtwork) return;
        const img = col.querySelector<HTMLImageElement>('img.track-art');
        if (!img) return;
        const apply = (): void => {
            if (img.src === FALLBACK_ART_DATA_URI) return;
            const aspect = classifyArtAspect(img.naturalWidth, img.naturalHeight);
            if (aspect === 'landscape') col.className = `${CARD_LANDSCAPE_GRID_CLASSES} track-card-landscape`;
            else if (aspect === 'portrait') col.classList.add('track-card-portrait');
        };
        if (img.complete && img.naturalWidth > 0) apply();
        else img.addEventListener('load', apply, { once: true });
    }


    private createPlaylistCard(playlist: PlaylistInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const firstTrack = tracksById.get(playlist.entries[0]?.trackId ?? '');
        const artSrc = renderTrackArt(firstTrack);
        const artists = this.playlistArtists(playlist);
        const meta = this.buildCardMeta('playlist', playlist.durationSeconds);
        const col = document.createElement('div');
        col.className = CARD_SQUARE_GRID_CLASSES;
        col.innerHTML = cardHtml({
            href: detailHref('playlist', playlist.id),
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            altText: 'Playlist cover',
            title: playlist.name,
            artist: artists,
            meta,
        });
        applyPlaylistCover(col.querySelector('img'), playlist.entries.map((entry) => tracksById.get(entry.trackId)));
        col.querySelector('a')?.addEventListener('click', (event) => {
            event.preventDefault();
            this.callbacks.openPlaylist(playlist.id);
        });
        return col;
    }

    private createAlbumRow(album: AlbumInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => this.callbacks.openAlbum(album.id));
        tr.innerHTML = mediaRowHtml({
            artSrc: renderTrackArt(album.coverTrackId ? tracksById.get(album.coverTrackId) : null),
            fallbackArt: FALLBACK_ART_DATA_URI,
            title: album.title,
            artist: album.artist || 'Unknown artist',
            type: 'Album',
            year: album.year,
            duration: formatHoursMinutes(album.durationSeconds),
            hapticIcons: renderHapticIcons(this.albumFunscriptTypes(album, tracksById)),
        });
        return tr;
    }

    private createPlaylistRow(playlist: PlaylistInfo, tracksById: Map<string, TrackInfo>): HTMLElement {
        const firstTrack = tracksById.get(playlist.entries[0]?.trackId ?? '');
        const artSrc = renderTrackArt(firstTrack);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => this.callbacks.openPlaylist(playlist.id));
        tr.innerHTML = mediaRowHtml({
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            title: playlist.name,
            artist: this.playlistArtists(playlist),
            type: 'Playlist',
            year: '',
            duration: formatHoursMinutes(playlist.durationSeconds),
            hapticIcons: renderHapticIcons(this.playlistFunscriptTypes(playlist, tracksById)),
        });
        applyPlaylistCover(tr.querySelector('img'), playlist.entries.map((entry) => tracksById.get(entry.trackId)));
        return tr;
    }

    private createTrackRow(track: TrackInfo): HTMLElement {
        const artSrc = renderTrackArt(track);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => this.callbacks.openTrack(track.id));
        tr.innerHTML = mediaRowHtml({
            artSrc,
            fallbackArt: FALLBACK_ART_DATA_URI,
            title: track.title,
            artist: track.artist,
            type: track.type === 'video' ? 'Video' : 'Audio',
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

    private playlistFunscriptTypes(playlist: PlaylistInfo, tracksById: Map<string, TrackInfo>): FunscriptType[] {
        const types = new Set<FunscriptType>();
        for (const entry of playlist.entries) {
            for (const f of tracksById.get(entry.trackId)?.funscripts ?? []) types.add(f.type);
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
