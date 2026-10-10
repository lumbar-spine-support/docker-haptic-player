import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { AlbumInfo, PlaylistInfo, TrackInfo } from '../../src/shared/types';
import type { LibraryCallbacks } from '../../src/client/components/library';

const TAG = '[client:library]';

// The Library class module transitively imports `.html` template files (using
// esbuild's `--loader:.html=text` in the real build), and reads DOM elements
// via `qs()` in its field initializers, and `utils/api` reads `window.location`
// at module-load time. A require hook and minimal globals are installed before
// the module is imported so these work under plain `node --test` (which runs
// this file as CommonJS via tsx).
const nodeRequire = createRequire(__filename);
nodeRequire.extensions['.html'] = (module: NodeModule, filename: string) => {
    (module as any).exports = fs.readFileSync(filename, 'utf8');
};

let Library: typeof import('../../src/client/components/library').Library;

const savedGlobals = Object.fromEntries(
    ['document', 'window', 'history', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

test.before(async () => {
    (globalThis as any).document = {
        querySelector: () => null,
        createElement: (tag: string) => new FakeElement(tag),
    };
    (globalThis as any).window = {
        location: { href: 'http://localhost/' },
    };
    ({ Library } = await import('../../src/client/components/library'));
});

test.after(() => {
    for (const [key, descriptor] of Object.entries(savedGlobals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
    }
});

/**
 * Just enough of an element for the library's row and card builders: children, classes,
 * attributes and listeners. `querySelector` finds descendants by tag name, and finds
 * `[data-card-actions]` when the assigned `innerHTML` (a real template) contains that slot.
 */
class FakeElement {
    readonly tagName: string;
    readonly children: FakeElement[] = [];
    readonly dataset: Record<string, string> = {};
    readonly style: Record<string, string> = {};
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, ((event: unknown) => void)[]>();
    readonly classes = new Set<string>();
    title = '';
    type = '';
    private html = '';
    private cardActions: FakeElement | null = null;

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    get className(): string { return [...this.classes].join(' '); }
    set className(value: string) {
        this.classes.clear();
        for (const name of value.split(/\s+/).filter(Boolean)) this.classes.add(name);
    }

    readonly classList = {
        add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
        remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
        contains: (name: string) => this.classes.has(name),
        toggle: (name: string, force?: boolean) => {
            const on = force ?? !this.classes.has(name);
            if (on) this.classes.add(name); else this.classes.delete(name);
            return on;
        },
    };

    get innerHTML(): string { return this.html; }
    set innerHTML(value: string) {
        this.html = value;
        this.children.length = 0;
        this.cardActions = value.includes('data-card-actions') ? new FakeElement('div') : null;
    }

    /** Like the DOM: text assigned here reads back HTML-escaped from `innerHTML` (used by `escapeHtml`). */
    set textContent(value: string) {
        this.innerHTML = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
    addEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    dispatch(type: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() { }, stopPropagation() { } });
    }

    querySelector(selector: string): FakeElement | null {
        if (selector === '[data-card-actions]') return this.cardActions;
        if (!/^[a-z]+$/.test(selector)) return null;
        for (const child of this.children) {
            if (child.tagName === selector.toUpperCase()) return child;
            const found = child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }
}

function lastChild(element: FakeElement): FakeElement {
    return element.children[element.children.length - 1];
}

function fakeLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
    const store = new Map(Object.entries(initial));
    (globalThis as any).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
    };
    return store;
}

function makeCallbacks(): LibraryCallbacks {
    return {
        openTrack: () => { },
        openAlbum: () => { },
        openPlaylist: () => { },
        navigateTo: () => { },
        isLibraryRoute: () => true,
        showLibrary: () => { },
    };
}

function makeTrack(overrides: Partial<TrackInfo> = {}): TrackInfo {
    return {
        id: 'track-1',
        type: 'audio',
        title: 'Track One',
        artist: 'Artist',
        filename: 'track-1.mp3',
        hasArtwork: false,
        durationSeconds: 60,
        year: '',
        funscripts: [],
        ...overrides,
    } as TrackInfo;
}

function makeAlbum(overrides: Partial<AlbumInfo> = {}): AlbumInfo {
    return {
        id: 'album-1',
        title: 'Album One',
        artist: 'Artist',
        trackIds: [],
        trackCount: 0,
        durationSeconds: 0,
        ...overrides,
    } as AlbumInfo;
}

function makePlaylist(overrides: Partial<PlaylistInfo> = {}): PlaylistInfo {
    return {
        id: 'playlist-1',
        name: 'Playlist One',
        entries: [],
        canDelete: false,
        durationSeconds: 0,
        ...overrides,
    } as PlaylistInfo;
}

test(`${TAG} allMedia combines tracks and videos`, () => {
    const library = new Library(makeCallbacks());
    const track = makeTrack({ id: 't1' });
    const video = makeTrack({ id: 'v1', type: 'video' });
    (library as any).tracks = [track];
    (library as any).videos = [video];

    const all = library.allMedia();
    assert.deepEqual(all.map((item) => item.id), ['t1', 'v1']);
});

test(`${TAG} getTrack finds a track or video by id`, () => {
    const library = new Library(makeCallbacks());
    const track = makeTrack({ id: 't1' });
    const video = makeTrack({ id: 'v1', type: 'video' });
    (library as any).tracks = [track];
    (library as any).videos = [video];

    assert.equal(library.getTrack('t1'), track);
    assert.equal(library.getTrack('v1'), video);
    assert.equal(library.getTrack('missing'), undefined);
});

test(`${TAG} getAlbum and getPlaylist find items by id`, () => {
    const library = new Library(makeCallbacks());
    const album = makeAlbum({ id: 'a1' });
    const playlist = makePlaylist({ id: 'p1' });
    (library as any).albums = [album];
    (library as any).playlists = [playlist];

    assert.equal(library.getAlbum('a1'), album);
    assert.equal(library.getAlbum('missing'), undefined);
    assert.equal(library.getPlaylist('p1'), playlist);
    assert.equal(library.getPlaylist('missing'), undefined);
});

test(`${TAG} findAlbumForTrack finds the album containing a track`, () => {
    const library = new Library(makeCallbacks());
    const album = makeAlbum({ id: 'a1', trackIds: ['t1', 't2'] });
    (library as any).albums = [album];

    assert.equal(library.findAlbumForTrack('t1'), album);
    assert.equal(library.findAlbumForTrack('t2'), album);
    assert.equal(library.findAlbumForTrack('t3'), undefined);
});

test(`${TAG} findPlaylistForTrack finds the playlist containing a track`, () => {
    const library = new Library(makeCallbacks());
    const playlist = makePlaylist({ id: 'p1', entries: [{ trackId: 't1' }, { trackId: 't2' }] as any });
    (library as any).playlists = [playlist];

    assert.equal(library.findPlaylistForTrack('t1'), playlist);
    assert.equal(library.findPlaylistForTrack('t2'), playlist);
    assert.equal(library.findPlaylistForTrack('t3'), undefined);
});

test(`${TAG} setActiveTags and activeTags_readonly stay in sync`, () => {
    const library = new Library(makeCallbacks());
    library.setActiveTags(['sfw', 'bunny']);
    assert.deepEqual(library.activeTags_readonly, ['sfw', 'bunny']);
});

function makeArtistLibrary(): InstanceType<typeof Library> {
    const library = new Library(makeCallbacks());
    (library as any).tracks = [
        makeTrack({ id: 't1', artist: 'Kinkyshibby', tags: ['kinky', 'asmr'] }),
        makeTrack({ id: 't2', artist: 'Someone Else', tags: ['asmr'] }),
    ];
    (library as any).videos = [];
    (library as any).albums = [makeAlbum({ id: 'a1', artist: 'Kinkyshibby', trackIds: ['t1'] })];
    (library as any).playlists = [
        makePlaylist({ id: 'p1', entries: [{ trackId: 't2', artist: 'Playlist Artist' }] as any }),
    ];
    return library;
}

test(`${TAG} getAllArtists collects unique artists from tracks, albums and playlists`, () => {
    const artists = (makeArtistLibrary() as any).getAllArtists();
    assert.deepEqual(artists, ['Kinkyshibby', 'Playlist Artist', 'Someone Else']);
});

test(`${TAG} getSuggestions lists matching artists before tags`, () => {
    const suggestions = (makeArtistLibrary() as any).getSuggestions('kinky');
    assert.deepEqual(suggestions, [
        { label: 'Kinkyshibby', value: 'artist:Kinkyshibby', artist: true },
        { label: 'kinky', value: 'kinky', artist: false },
    ]);
});

test(`${TAG} getSuggestions excludes already active artist filters`, () => {
    const library = makeArtistLibrary();
    library.setActiveTags(['artist:Kinkyshibby']);
    const suggestions = (library as any).getSuggestions('kinky');
    assert.deepEqual(suggestions.map((s: any) => s.value), ['kinky']);
});

test(`${TAG} an active artist filter narrows the track list`, () => {
    const library = makeArtistLibrary();
    library.setActiveTags(['artist:kinkyshibby']);
    const tracks = (library as any).filterTrackList((library as any).tracks);
    assert.deepEqual(tracks.map((t: TrackInfo) => t.id), ['t1']);
});

test(`${TAG} artist and tag filters combine`, () => {
    const library = makeArtistLibrary();
    library.setActiveTags(['artist:Kinkyshibby', 'asmr']);
    assert.deepEqual(
        (library as any).filterTrackList((library as any).tracks).map((t: TrackInfo) => t.id),
        ['t1'],
    );

    library.setActiveTags(['artist:Kinkyshibby', 'nope']);
    assert.deepEqual((library as any).filterTrackList((library as any).tracks), []);
});

test(`${TAG} artist filters apply to albums and playlists`, () => {
    const library = makeArtistLibrary();
    library.setActiveTags(['artist:Kinkyshibby']);
    assert.deepEqual((library as any).getFilteredAlbums().map((a: AlbumInfo) => a.id), ['a1']);
    assert.deepEqual((library as any).getFilteredPlaylists(), []);

    library.setActiveTags(['artist:Playlist Artist']);
    assert.deepEqual((library as any).getFilteredPlaylists().map((p: PlaylistInfo) => p.id), ['p1']);
    assert.deepEqual((library as any).getFilteredAlbums(), []);
});

test(`${TAG} artist filters are removed like regular tags`, () => {
    const library = new Library(makeCallbacks());
    (globalThis as any).history = { pushState: () => { } };
    library.setActiveTags(['artist:Kinkyshibby', 'asmr']);
    (library as any).removeTag('artist:Kinkyshibby');
    assert.deepEqual(library.activeTags_readonly, ['asmr']);
});

test(`${TAG} the favorites filter keeps favorite tracks, albums with one and favorite playlists`, () => {
    const library = new Library(makeCallbacks());
    (library as any).tracks = [
        makeTrack({ id: 't1', isFavorite: true }),
        makeTrack({ id: 't2', isFavorite: false }),
    ];
    (library as any).videos = [makeTrack({ id: 'v1', type: 'video', isFavorite: true })];
    (library as any).albums = [
        makeAlbum({ id: 'a1', trackIds: ['t1', 't2'] }),
        makeAlbum({ id: 'a2', trackIds: ['t2'] }),
    ];
    (library as any).playlists = [
        makePlaylist({ id: 'p1', isFavorite: true }),
        makePlaylist({ id: 'p2', isFavorite: false }),
    ];

    assert.equal((library as any).filterTrackList((library as any).tracks).length, 2, 'off by default');

    (library as any).favoritesOnly = true;
    assert.deepEqual((library as any).filterTrackList((library as any).tracks).map((t: TrackInfo) => t.id), ['t1']);
    assert.deepEqual((library as any).filterTrackList((library as any).videos).map((t: TrackInfo) => t.id), ['v1']);
    assert.deepEqual((library as any).getFilteredAlbums().map((a: AlbumInfo) => a.id), ['a1']);
    assert.deepEqual((library as any).getFilteredPlaylists().map((p: PlaylistInfo) => p.id), ['p1']);
});

test(`${TAG} the favorites filter is restored from and saved to localStorage`, () => {
    fakeLocalStorage({
        'happy-library-filters': JSON.stringify({ favorites: true, tracks: true, 'haptic-vibrator': true }),
        'happy-library-sort': JSON.stringify({ field: 'not-a-field', asc: false }),
    });
    const library = new Library(makeCallbacks());
    (library as any).loadLibraryFilters();
    assert.equal((library as any).favoritesOnly, true);
    assert.deepEqual([...(library as any).mediaFilters], ['tracks']);
    assert.deepEqual([...(library as any).hapticFilters], ['vibrator']);
    assert.equal((library as any).sortAsc, false);

    fakeLocalStorage({ 'happy-library-filters': JSON.stringify({ favorites: 'yes' }) });
    const other = new Library(makeCallbacks());
    (other as any).loadLibraryFilters();
    assert.equal((other as any).favoritesOnly, false, 'only a stored true turns it on');

    fakeLocalStorage({ 'happy-library-filters': '{not json' });
    const broken = new Library(makeCallbacks());
    (broken as any).loadLibraryFilters();
    assert.equal((broken as any).favoritesOnly, false, 'unreadable filters fall back to none');

    const store = fakeLocalStorage();
    (library as any).saveLibraryFilters();
    const saved = JSON.parse(store.get('happy-library-filters')!);
    assert.equal(saved.favorites, true);
    assert.equal(saved.tracks, true);
    assert.equal(saved.videos, false);
    assert.equal(saved['haptic-vibrator'], true);
});

test(`${TAG} the favorites toggle flips the filter, its heart and the stored filters`, () => {
    const store = fakeLocalStorage();
    const library = new Library(makeCallbacks());
    const button = new FakeElement('button');
    const icon = button.appendChild(new FakeElement('i'));
    (library as any).favoritesToggle = button;
    let renders = 0;
    (library as any).render = () => { renders++; };

    (library as any).bindFavoritesFilter();
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(button.classList.contains('active'), false);
    assert.equal(button.title, 'Show favorites only');
    assert.equal(icon.classList.contains('bi-heart'), true);
    assert.equal(renders, 0, 'binding alone does not re-render');

    button.dispatch('click');
    assert.equal((library as any).favoritesOnly, true);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.classList.contains('active'), true);
    assert.equal(button.title, 'Showing favorites only');
    assert.equal(icon.classList.contains('bi-heart-fill'), true);
    assert.equal(icon.classList.contains('bi-heart'), false);
    assert.equal(JSON.parse(store.get('happy-library-filters')!).favorites, true);
    assert.equal(renders, 1);

    button.dispatch('click');
    assert.equal((library as any).favoritesOnly, false);
    assert.equal(JSON.parse(store.get('happy-library-filters')!).favorites, false);
    assert.equal(renders, 2);
});

test(`${TAG} without a favorites toggle in the page, binding is a no-op`, () => {
    const library = new Library(makeCallbacks());
    assert.doesNotThrow(() => (library as any).bindFavoritesFilter());
});

test(`${TAG} an empty favorites-only result says the filters hide everything`, () => {
    const library = new Library(makeCallbacks());
    const grid = new FakeElement('div');
    (library as any).grid = grid;
    (library as any).list = new FakeElement('tbody');
    (library as any).tracks = [makeTrack({ id: 't1', isFavorite: false })];
    (library as any).videos = [];

    (library as any).favoritesOnly = true;
    library.render();
    assert.match(grid.innerHTML, /No items match your search or filters\./);

    (library as any).tracks = [];
    (library as any).favoritesOnly = false;
    library.render();
    assert.match(grid.innerHTML, /No media files found/);
});

test(`${TAG} rows end with the queue menu, after a favorite heart for tracks and playlists`, () => {
    const library = new Library(makeCallbacks());
    const tracksById = new Map<string, TrackInfo>();

    const trackRow = (library as any).createTrackRow(makeTrack({ id: 't1', isFavorite: true })) as FakeElement;
    const trackCell = lastChild(trackRow);
    assert.equal(trackCell.tagName, 'TD');
    assert.equal(trackCell.classList.contains('favorite-cell'), true);
    const [heart, trackMenu] = trackCell.children[0].children;
    assert.equal(heart.tagName, 'BUTTON');
    assert.equal(trackMenu.classList.contains('queue-menu'), true);
    assert.equal(heart.dataset.favoriteId, 't1');
    assert.equal(heart.getAttribute('aria-pressed'), 'true');

    const playlistRow = (library as any).createPlaylistRow(makePlaylist({ id: 'p1', isFavorite: false }), tracksById) as FakeElement;
    const playlistHeart = lastChild(playlistRow).children[0].children[0];
    assert.equal(playlistHeart.dataset.favoriteId, 'p1');
    assert.equal(playlistHeart.getAttribute('aria-pressed'), 'false');

    const albumRow = (library as any).createAlbumRow(makeAlbum({ id: 'a1' }), tracksById) as FakeElement;
    const albumCell = lastChild(albumRow);
    assert.equal(albumCell.classList.contains('favorite-cell'), true);
    const albumActions = albumCell.children[0].children;
    assert.equal(albumActions.length, 1, 'client-side albums are not Jellyfin items and have no heart');
    assert.equal(albumActions[0].classList.contains('queue-menu'), true);
});

test(`${TAG} track and playlist cards put a favorite heart and the queue menu in the card actions`, () => {
    const library = new Library(makeCallbacks());
    const trackCard = (library as any).createTrackCard(makeTrack({ id: 't1', isFavorite: false })) as FakeElement;
    const [trackHeart, trackMenu] = trackCard.querySelector('[data-card-actions]')!.children[0].children;
    assert.equal(trackHeart.dataset.favoriteId, 't1');
    assert.equal(trackMenu.classList.contains('queue-menu'), true);
    assert.equal(trackHeart.title, 'Add to favorites');

    const playlistCard = (library as any).createPlaylistCard(makePlaylist({ id: 'p1', isFavorite: true }), new Map()) as FakeElement;
    const playlistHeart = playlistCard.querySelector('[data-card-actions]')!.children[0].children[0];
    assert.equal(playlistHeart.dataset.favoriteId, 'p1');
    assert.equal(playlistHeart.title, 'Remove from favorites');
});
