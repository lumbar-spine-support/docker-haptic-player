import test from 'node:test';
import assert from 'node:assert/strict';

import { login, skip, type JellyfinSession } from './session';
import { loadLibrary, setFavorite } from '../../../src/client/jellyfin/library';
import { imageUrl, streamUrl, trickplaySheetUrl, trickplayVtt } from '../../../src/client/jellyfin/urls';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../../src/shared/funscriptNames';
import type { LibraryResponse, TrackInfo } from '../../../src/shared/types';

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
    test(`[jellyfin-library] ${type} streams answer range requests`, { skip }, async (t) => {
        const track = media.find((candidate) => candidate.type === type);
        if (!track) return t.skip(`no ${type} items visible to the test user`);
        const url = streamUrl({ serverUrl: serverUrl(), token: session.token }, track);
        const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
        await res.body?.cancel();
        assert.equal(res.status, 206);
        assert.match(String(res.headers.get('content-range')), /^bytes 0-1023\//);
    });
}

test('[jellyfin-library] cover art loads without a token', { skip }, async (t) => {
    const track = media.find((candidate) => candidate.hasArtwork);
    if (!track) return t.skip('no items with artwork');
    const res = await fetch(imageUrl(serverUrl(), track.id, track.artworkTag));
    await res.body?.cancel();
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /^image\//);
});

test('[jellyfin-library] trickplay sheets are reachable', { skip }, async (t) => {
    const track = media.find((candidate) => candidate.trickplay);
    if (!track?.trickplay) return t.skip('trickplay has not been generated for any visible video');
    const res = await fetch(trickplaySheetUrl({ serverUrl: serverUrl(), token: session.token }, track.id, track.trickplay, 0));
    await res.body?.cancel();
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /^image\//);
});

test('[jellyfin-library] the storyboard VTT points at sheets the browser can load', { skip }, async (t) => {
    const track = media.find((candidate) => candidate.trickplay);
    if (!track?.trickplay) return t.skip('trickplay has not been generated for any visible video');
    const vtt = trickplayVtt({ serverUrl: serverUrl(), token: session.token }, track);
    assert.ok(vtt);
    const cues = vtt.trimEnd().split('\n\n').slice(1);
    assert.equal(cues.length, Math.min(track.trickplay.count, Math.ceil(track.durationSeconds / track.trickplay.intervalSeconds)));
    const [, target] = cues[0].split('\n');
    const [sheet, fragment] = target.split('#');
    assert.match(fragment, /^xywh=0,0,\d+,\d+$/);
    const res = await fetch(sheet);
    await res.body?.cancel();
    assert.equal(res.status, 200, 'the token in the sheet URL is accepted');
    assert.match(String(res.headers.get('content-type')), /^image\//);
});

test('[jellyfin-library] favorites round-trip through Jellyfin', { skip }, async (t) => {
    const track = media[0];
    if (!track) return t.skip('no playable items visible to the test user');
    const original = track.isFavorite;
    assert.equal(typeof original, 'boolean');
    try {
        assert.equal(await setFavorite(session, track.id, !original), !original);
        const reloaded = await loadLibrary(session, { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded'] });
        const again = [...reloaded.tracks, ...reloaded.videos].find((candidate) => candidate.id === track.id);
        assert.equal(again?.isFavorite, !original, 'the library sees the new state');
    } finally {
        assert.equal(await setFavorite(session, track.id, original), original, 'restores the original state');
    }
});
