import test from 'node:test';
import assert from 'node:assert/strict';

import { login, skip, type JellyfinSession } from './session';
import { loadLibrary } from '../../../src/client/jellyfin/library';
import { imageUrl, streamUrl, trickplaySheetUrl } from '../../../src/client/jellyfin/urls';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../../src/shared/funscriptNames';
import type { LibraryResponse, TrackInfo } from '../../../src/shared/types';

// HAPPY serves the client from its own origin; every media request is cross-origin to Jellyfin.
const ORIGIN = 'http://localhost:3000';

let session: JellyfinSession;
let library: LibraryResponse;
let media: TrackInfo[];

test.before(async () => {
    if (skip) return;
    session = await login('library');
    library = await loadLibrary(session, {
        funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES,
        chapterSourcePriority: ['embedded', 'funscript'],
    });
    media = [...library.tracks, ...library.videos];
});

test.after(async () => {
    await session?.logout();
});

const serverUrl = (): string => String(process.env.HAPPY_JELLYFIN_URL).replace(/\/+$/, '');

test('[jellyfin-library] maps every playable item to a well-formed track', { skip }, () => {
    assert.ok(media.length > 0, 'the test user sees at least one playable item');
    for (const track of media) {
        assert.match(track.id, /^[0-9a-f]{32}$/);
        assert.ok(track.type === 'audio' || track.type === 'video');
        assert.ok(track.title.length > 0);
        assert.ok(track.filename.length > 0, 'Path is visible to the user, so VR detection works');
        assert.ok(track.durationSeconds > 0);
        assert.equal(track.hasArtwork, track.artworkTag !== null);
        for (const chapter of track.chapters ?? []) assert.ok(chapter.end >= chapter.start);
    }
    console.log(`# ${library.tracks.length} audio, ${library.videos.length} video, ${library.albums.length} albums, `
        + `${library.playlists.length} playlists, ${media.filter((t) => t.funscripts.length).length} with funscripts, `
        + `${media.filter((t) => t.trickplay).length} with trickplay`);
});

test('[jellyfin-library] albums and playlists only reference known tracks', { skip }, () => {
    const ids = new Set(media.map((track) => track.id));
    for (const album of library.albums) {
        assert.ok(album.trackIds.length > 0);
        for (const id of album.trackIds) assert.ok(ids.has(id));
    }
    for (const playlist of library.playlists) {
        for (const entry of playlist.entries) assert.ok(ids.has(entry.trackId));
    }
});

test('[jellyfin-library] funscripts are typed and downloadable', { skip }, async (t) => {
    const track = media.find((candidate) => candidate.funscripts.length > 0);
    if (!track) return t.skip('no funscripts in the libraries visible to the test user');
    for (const script of media.flatMap((candidate) => candidate.funscripts)) {
        assert.match(script.key, /^[0-9a-f]{16}$/);
        assert.ok(['stroker', 'buttplug', 'vibrator', 'estim', 'machine', 'unknown'].includes(script.type));
    }
    const res = await session.request(`/Happy/Items/${track.id}/Funscripts/${track.funscripts[0].key}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(((await res.json()) as { actions?: unknown }).actions));
});

for (const type of ['audio', 'video'] as const) {
    test(`[jellyfin-library] ${type} streams answer range requests cross-origin`, { skip }, async (t) => {
        const track = media.find((candidate) => candidate.type === type);
        if (!track) return t.skip(`no ${type} items visible to the test user`);
        const url = streamUrl({ serverUrl: serverUrl(), token: session.token }, track);
        const res = await fetch(url, { headers: { Range: 'bytes=0-1023', Origin: ORIGIN } });
        await res.body?.cancel();
        assert.equal(res.status, 206);
        assert.match(String(res.headers.get('content-range')), /^bytes 0-1023\//);
        const allowed = res.headers.get('access-control-allow-origin');
        assert.ok(allowed === '*' || allowed === ORIGIN, 'CORS is required for WebGL (VR) and canvas use');
    });
}

test('[jellyfin-library] cover art loads cross-origin without a token', { skip }, async (t) => {
    const track = media.find((candidate) => candidate.hasArtwork);
    if (!track) return t.skip('no items with artwork');
    const res = await fetch(imageUrl(serverUrl(), track.id, track.artworkTag), { headers: { Origin: ORIGIN } });
    await res.body?.cancel();
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /^image\//);
    assert.ok(res.headers.get('access-control-allow-origin'), 'the playlist collage draws covers onto a canvas');
});

test('[jellyfin-library] trickplay sheets are reachable', { skip }, async (t) => {
    const track = media.find((candidate) => candidate.trickplay);
    if (!track?.trickplay) return t.skip('trickplay has not been generated for any visible video');
    const res = await fetch(trickplaySheetUrl({ serverUrl: serverUrl(), token: session.token }, track.id, track.trickplay, 0),
        { headers: { Origin: ORIGIN } });
    await res.body?.cancel();
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /^image\//);
});
