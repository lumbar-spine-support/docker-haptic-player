import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import type { Chapter, FunscriptInfo, TrackInfo } from '../../src/shared/types';
import type { JellyfinConnection } from '../../src/client/jellyfin/connection';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../src/shared/funscriptNames';

const TAG = '[client:api]';
const SERVER = 'https://jellyfin.example.com';
const OPTIONS = { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded', 'funscript'] as const };

let api: typeof import('../../src/client/api');

type Call = { path: string; init?: RequestInit };

/** A stand-in for the signed-in connection: answers `request()` from `routes` and records each call. */
function fakeConnection(routes: Record<string, () => Response> = {}, borrowed = false) {
    const calls: Call[] = [];
    let signedOut = 0;
    const connection = {
        serverUrl: SERVER,
        userId: 'user 1',
        borrowed,
        endpoint: { serverUrl: SERVER, token: 'tok' },
        async request(path: string, init?: RequestInit): Promise<Response> {
            calls.push({ path, init });
            const route = Object.keys(routes).find((prefix) => path.startsWith(prefix));
            return route ? routes[route]() : new Response('not found', { status: 404 });
        },
        async signOut(): Promise<void> { signedOut++; },
    };
    return { connection: connection as unknown as JellyfinConnection, calls, signedOut: () => signedOut };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function blobText(url: string): Promise<string> {
    const blob = resolveObjectURL(url);
    assert.ok(blob, `${url} resolves to a blob`);
    return blob.text();
}

const originalWindow = (globalThis as any).window;
const originalFetch = globalThis.fetch;

test.before(async () => {
    api = await import('../../src/client/api');
});

test.after(() => {
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;
});

// Must run before any useJellyfin(): the module starts without a connection.
test(`${TAG} media calls before useJellyfin() throw`, async () => {
    assert.throws(() => api.mediaUrl({ id: 'a', type: 'audio' }), /useJellyfin/);
    assert.throws(() => api.artworkUrl('a'), /useJellyfin/);
    assert.throws(() => api.fetchLibrary(), /useJellyfin/);
    await assert.rejects(api.fetchVersion(), /useJellyfin/);
});

test(`${TAG} logout without a connection just reloads`, async () => {
    let reloads = 0;
    (globalThis as any).window = { location: { reload: () => { reloads++; }, assign: () => assert.fail('no assign') } };
    await api.logout();
    assert.equal(reloads, 1);
});

test(`${TAG} mediaUrl streams the original file with the token`, () => {
    api.useJellyfin(fakeConnection().connection, OPTIONS);
    assert.equal(api.mediaUrl({ id: 'v 1', type: 'video' }), `${SERVER}/Videos/v%201/stream?static=true&ApiKey=tok`);
    assert.equal(api.mediaUrl({ id: 'a1', type: 'audio' }), `${SERVER}/Audio/a1/stream?static=true&ApiKey=tok`);
});

test(`${TAG} artworkUrl and renderTrackArt`, () => {
    api.useJellyfin(fakeConnection().connection, OPTIONS);
    const url = api.artworkUrl('item', 'abc');
    assert.ok(url.startsWith(`${SERVER}/Items/item/Images/Primary?`));
    assert.match(url, /tag=abc/);
    assert.doesNotMatch(api.artworkUrl('item'), /tag=/);
    assert.equal(api.renderTrackArt({ id: 'item', hasArtwork: true, artworkTag: 'abc' } as TrackInfo), url);
    assert.equal(api.renderTrackArt({ id: 'item', hasArtwork: false } as TrackInfo), api.FALLBACK_ART_DATA_URI);
    assert.equal(api.renderTrackArt(null), api.FALLBACK_ART_DATA_URI);
    assert.match(api.FALLBACK_ART_DATA_URI, /^data:image\/svg\+xml,/);
});

test(`${TAG} docAssetUrl encodes each path segment but keeps slashes`, () => {
    api.useJellyfin(fakeConnection().connection, OPTIONS);
    assert.equal(api.docAssetUrl('img/a b.png'), `${SERVER}/Happy/Docs/assets/img/a%20b.png`);
});

test(`${TAG} fetchDoc reads markdown anonymously and reports failures`, async () => {
    api.useJellyfin(fakeConnection().connection, OPTIONS);
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
        urls.push(url);
        return url.endsWith('missing') ? new Response('', { status: 404 }) : new Response('# Hello');
    }) as typeof fetch;
    try {
        assert.equal(await api.fetchDoc('getting started'), '# Hello');
        assert.deepEqual(urls, [`${SERVER}/Happy/Docs/getting%20started`]);
        await assert.rejects(api.fetchDoc('missing'), /Docs fetch failed: 404/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test(`${TAG} fetchFunscript requests the plugin route with encoded ids`, async () => {
    const script = { actions: [{ at: 0, pos: 50 }], metadata: { chapters: [] } };
    const { connection, calls } = fakeConnection({ '/Happy/Items/': () => json(script) });
    api.useJellyfin(connection, OPTIONS);
    const track = { id: 't/1' } as TrackInfo;
    const result = await api.fetchFunscript(track, { key: 'main vib' } as FunscriptInfo);
    assert.deepEqual(result, script);
    assert.equal(calls[0].path, '/Happy/Items/t%2F1/Funscripts/main%20vib');
});

test(`${TAG} fetchFunscript throws on HTTP errors`, async () => {
    api.useJellyfin(fakeConnection({ '/Happy/Items/': () => json({}, 500) }).connection, OPTIONS);
    await assert.rejects(api.fetchFunscript({ id: 't' } as TrackInfo, { key: 'k' } as FunscriptInfo), /Funscript fetch failed: 500/);
});

test(`${TAG} fetchVersion maps the plugin info`, async () => {
    api.useJellyfin(fakeConnection({ '/Happy/Info': () => json({ Version: '0.16.0.0', Channel: 'preview', Commit: 'abc' }) }).connection, OPTIONS);
    assert.deepEqual(await api.fetchVersion(), { version: '0.16.0', channel: 'preview', commit: 'abc', builtAt: null });
    api.useJellyfin(fakeConnection({ '/Happy/Info': () => json({}, 401) }).connection, OPTIONS);
    await assert.rejects(api.fetchVersion(), /Version fetch failed: 401/);
});

test(`${TAG} fetchClientSettings returns the plugin config`, async () => {
    const settings = { defaultVolume: 0.5 };
    api.useJellyfin(fakeConnection({ '/Happy/Config': () => json(settings) }).connection, OPTIONS);
    assert.deepEqual(await api.fetchClientSettings(), settings);
    api.useJellyfin(fakeConnection({ '/Happy/Config': () => json({}, 403) }).connection, OPTIONS);
    await assert.rejects(api.fetchClientSettings(), /Config fetch failed: 403/);
});

test(`${TAG} fetchLibrary loads items, funscripts and playlists for the user`, async () => {
    const { connection, calls } = fakeConnection({
        '/Items?': () => json({ Items: [] }),
        '/Happy/Funscripts': () => json({}),
    });
    api.useJellyfin(connection, OPTIONS);
    const library = await api.fetchLibrary();
    assert.deepEqual(library.tracks, []);
    assert.deepEqual(library.videos, []);
    assert.deepEqual(library.playlists, []);
    assert.ok(calls.some((c) => c.path === '/Happy/Funscripts'));
    assert.ok(calls.filter((c) => c.path.startsWith('/Items?userId=user%201')).length >= 2);
});

test(`${TAG} setJellyfinFavorite posts or deletes and returns the stored state`, async () => {
    const { connection, calls } = fakeConnection({ '/UserFavoriteItems/': () => json({ IsFavorite: true }) });
    api.useJellyfin(connection, OPTIONS);
    assert.equal(await api.setJellyfinFavorite('item 1', true), true);
    assert.equal(calls[0].path, '/UserFavoriteItems/item%201?userId=user%201');
    assert.equal(calls[0].init?.method, 'POST');
    await api.setJellyfinFavorite('item 1', false);
    assert.equal(calls[1].init?.method, 'DELETE');
});

test(`${TAG} chaptersVttUrl builds one blob per chapter list`, async () => {
    api.useJellyfin(fakeConnection().connection, OPTIONS);
    assert.equal(api.chaptersVttUrl({ id: 'x' } as TrackInfo), null);
    assert.equal(api.chaptersVttUrl({ id: 'x', chapters: [] as Chapter[] } as TrackInfo), null);
    const chapters: Chapter[] = [{ name: 'Intro', start: 0, end: 10 }, { name: 'Main', start: 10, end: 20 }];
    const track = { id: 'x', chapters } as TrackInfo;
    const url = api.chaptersVttUrl(track);
    assert.ok(url?.startsWith('blob:'));
    assert.equal(api.chaptersVttUrl({ ...track }), url, 'cached by the chapters array');
    const vtt = await blobText(url!);
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /Intro/);
    assert.match(vtt, /Main/);
});

test(`${TAG} storyboardVttUrl only for videos with trickplay, cached per track`, async () => {
    api.useJellyfin(fakeConnection().connection, OPTIONS);
    assert.equal(api.storyboardVttUrl({ id: 'a', type: 'audio' } as TrackInfo), null);
    assert.equal(api.storyboardVttUrl({ id: 'v0', type: 'video' } as TrackInfo), null);
    const trickplay = { mediaSourceId: 'ms', resolution: 320, width: 320, height: 180, columns: 2, rows: 2, count: 5, intervalSeconds: 10 };
    const track = { id: 'v1', type: 'video', filename: 'clip.mp4', durationSeconds: 50, trickplay } as unknown as TrackInfo;
    const url = api.storyboardVttUrl(track);
    assert.ok(url?.startsWith('blob:'));
    assert.equal(api.storyboardVttUrl(track), url);
    const vtt = await blobText(url!);
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /\/Videos\/v1\/Trickplay\/320\/0\.jpg\?mediaSourceId=ms&ApiKey=tok/);
    assert.match(vtt, /\/Trickplay\/320\/1\.jpg/, 'five tiles need a second 2x2 sheet');
});

test(`${TAG} logout signs out and reloads an own session`, async () => {
    const fake = fakeConnection();
    api.useJellyfin(fake.connection, OPTIONS);
    const actions: string[] = [];
    (globalThis as any).window = { location: { reload: () => actions.push('reload'), assign: (url: string) => actions.push(`assign:${url}`) } };
    await api.logout();
    assert.equal(fake.signedOut(), 1);
    assert.deepEqual(actions, ['reload']);
});

test(`${TAG} logout of a borrowed session returns to Jellyfin's web client`, async () => {
    const fake = fakeConnection({}, true);
    api.useJellyfin(fake.connection, OPTIONS);
    const actions: string[] = [];
    (globalThis as any).window = { location: { reload: () => actions.push('reload'), assign: (url: string) => actions.push(`assign:${url}`) } };
    await api.logout();
    assert.equal(fake.signedOut(), 1);
    assert.deepEqual(actions, [`assign:${api.JELLYFIN_WEB_URL}`]);
});

test(`${TAG} playlist collage falls back to the first cover without a 2D context`, async () => {
    api.useJellyfin(fakeConnection().connection, OPTIONS);
    const originalDocument = (globalThis as any).document;
    const originalImage = (globalThis as any).Image;
    (globalThis as any).document = { createElement: () => ({ getContext: () => null }) };
    (globalThis as any).Image = class {
        onload: (() => void) | null = null;
        set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    };
    try {
        const tracks = ['n1', 'n2', 'n3', 'n4'].map((id) => ({ id, hasArtwork: true, artworkTag: 't' }) as TrackInfo);
        assert.equal(await api.playlistCoverArt(tracks), api.renderTrackArt(tracks[0]));
    } finally {
        (globalThis as any).document = originalDocument;
        (globalThis as any).Image = originalImage;
    }
});

test(`${TAG} applyPlaylistCover ignores a missing image`, () => {
    assert.doesNotThrow(() => api.applyPlaylistCover(null, []));
});
