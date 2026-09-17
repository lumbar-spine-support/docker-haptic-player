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

test.before(async () => {
    (globalThis as any).document = {
        querySelector: () => null,
    };
    (globalThis as any).window = {
        location: { href: 'http://localhost/' },
    };
    ({ Library } = await import('../../src/client/components/library'));
});

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
