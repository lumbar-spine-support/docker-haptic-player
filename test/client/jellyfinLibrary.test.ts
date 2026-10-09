import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { JellyfinItemDto } from '../../src/client/jellyfin/dto';
import { JellyfinRequestError, loadLibrary, setFavorite, type JellyfinApi, type LoadOptions } from '../../src/client/jellyfin/library';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../src/shared/funscriptNames';

const TAG = '[client:jellyfin-library]';
const OPTIONS: LoadOptions = { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded', 'funscript'] };
const USER = 'user id/1';

const AUDIO: JellyfinItemDto = {
    Id: 'a1', Name: 'Song', Type: 'Audio', MediaType: 'Audio', Path: '/media/Song.mp3', RunTimeTicks: 60 * 10_000_000,
};
const VIDEO: JellyfinItemDto = {
    Id: 'v1', Name: 'Clip', Type: 'Movie', MediaType: 'Video', Path: '/media/Clip.mp4', RunTimeTicks: 30 * 10_000_000,
};
const PLAYLIST: JellyfinItemDto = { Id: 'p 1', Name: 'Mix', Type: 'Playlist', UserData: { IsFavorite: true } } as JellyfinItemDto;
const EMPTY_PLAYLIST: JellyfinItemDto = { Id: 'p2', Name: 'Nothing playable', Type: 'Playlist' };

type Route = (path: string, init?: RequestInit) => Response | undefined;

/** A fake signed-in session answering by path; records every request it receives. */
function fakeApi(route: Route): JellyfinApi & { calls: { path: string; init?: RequestInit }[] } {
    const calls: { path: string; init?: RequestInit }[] = [];
    return {
        userId: USER,
        calls,
        async request(path: string, init?: RequestInit) {
            calls.push({ path, init });
            return route(path, init) ?? new Response('not found', { status: 404 });
        },
    };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Routes of a Jellyfin server with the HAPPY plugin, one playlist with entries and one without. */
function libraryRoutes(overrides: Record<string, Response> = {}): Route {
    return (path) => {
        for (const [prefix, res] of Object.entries(overrides)) if (path.startsWith(prefix)) return res;
        if (path === '/Happy/Funscripts') return json({ v1: [{ Key: 'k1', FileName: 'Clip.funscript' }] });
        if (path.startsWith('/Items?') && path.includes('IncludeItemTypes=Playlist')) return json({ Items: [PLAYLIST, EMPTY_PLAYLIST] });
        if (path.startsWith('/Items?')) return json({ Items: [AUDIO, VIDEO] });
        if (path.startsWith('/Playlists/p%201/Items')) return json({ Items: [VIDEO, { Id: 'gone' }, AUDIO] });
        if (path.startsWith('/Playlists/p2/Items')) return json({ Items: [] });
        return undefined;
    };
}

let warn: typeof console.warn;
const warnings: unknown[][] = [];
before(() => {
    warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
});
after(() => {
    console.warn = warn;
});

test(`${TAG} loads items, funscripts and playlists into the library`, async () => {
    const api = fakeApi(libraryRoutes());
    const library = await loadLibrary(api, OPTIONS);

    assert.deepEqual(library.tracks.map((t) => t.id), ['a1']);
    assert.deepEqual(library.videos.map((t) => t.id), ['v1']);
    assert.deepEqual(library.videos[0].funscripts.map((f) => f.key), ['k1']);
    // The playlist without playable entries is dropped; unknown entries are skipped, order kept.
    assert.equal(library.playlists.length, 1);
    const [playlist] = library.playlists;
    assert.equal(playlist.id, 'p 1');
    assert.equal(playlist.isFavorite, true);
    assert.deepEqual(playlist.entries.map((e) => e.trackId), ['v1', 'a1']);
    assert.equal(playlist.durationSeconds, 90);
});

test(`${TAG} requests are scoped to the user and ask for the fields the mapper needs`, async () => {
    const api = fakeApi(libraryRoutes());
    await loadLibrary(api, OPTIONS);
    const paths = api.calls.map((c) => c.path);
    const items = paths.find((p) => p.startsWith('/Items?') && !p.includes('Playlist'));
    assert.ok(items);
    const query = new URL(items, 'http://x').searchParams;
    assert.equal(query.get('userId'), USER);
    assert.equal(query.get('Recursive'), 'true');
    assert.deepEqual(query.get('IncludeItemTypes')?.split(','), ['Audio', 'AudioBook', 'Video', 'Movie', 'MusicVideo', 'Episode']);
    assert.deepEqual(query.get('Fields')?.split(','), ['Path', 'Tags', 'Genres', 'Overview', 'Chapters', 'Trickplay']);
    assert.equal(query.get('EnableUserData'), 'true');
    assert.ok(paths.includes('/Happy/Funscripts'));
    // Playlist ids and the user id are URL-encoded.
    assert.ok(paths.includes(`/Playlists/p%201/Items?userId=${encodeURIComponent(USER)}`));
    assert.ok(paths.includes(`/Playlists/p2/Items?userId=${encodeURIComponent(USER)}`));
});

test(`${TAG} selected libraries are loaded one by one and merged`, async () => {
    const OTHER: JellyfinItemDto = { ...AUDIO, Id: 'a2', Name: 'Other song', Path: '/other/Other.mp3' };
    // Library "lib a" holds the audio and the video, "lib-b" the video again and another song.
    const routes = libraryRoutes();
    const scoped = fakeApi((path, init) => {
        if (path.startsWith('/Items?') && !path.includes('IncludeItemTypes=Playlist')) {
            const parent = new URL(path, 'http://x').searchParams.get('ParentId');
            if (parent === 'lib a') return json({ Items: [AUDIO, VIDEO] });
            if (parent === 'lib-b') return json({ Items: [VIDEO, OTHER] });
            return json({ Items: [] });
        }
        return routes(path, init);
    });
    const library = await loadLibrary(scoped, { ...OPTIONS, libraryIds: ['lib a', 'lib-b'] });

    const itemCalls = scoped.calls.map((c) => c.path).filter((p) => p.startsWith('/Items?') && !p.includes('Playlist'));
    assert.deepEqual(itemCalls.map((p) => new URL(p, 'http://x').searchParams.get('ParentId')), ['lib a', 'lib-b']);
    assert.ok(itemCalls[0].includes('ParentId=lib%20a'));
    assert.deepEqual(library.tracks.map((t) => t.id), ['a1', 'a2']);
    assert.deepEqual(library.videos.map((t) => t.id), ['v1']);
});

test(`${TAG} playlists keep only entries from the selected libraries`, async () => {
    const routes = libraryRoutes();
    const api = fakeApi((path, init) => {
        if (path.includes('ParentId=only-video')) return json({ Items: [VIDEO] });
        return routes(path, init);
    });
    const library = await loadLibrary(api, { ...OPTIONS, libraryIds: ['only-video'] });

    assert.deepEqual(library.tracks, []);
    assert.deepEqual(library.playlists[0].entries.map((e) => e.trackId), ['v1']);
});

test(`${TAG} without selected libraries one request loads all of them`, async () => {
    const api = fakeApi(libraryRoutes());
    await loadLibrary(api, { ...OPTIONS, libraryIds: [] });
    const itemCalls = api.calls.map((c) => c.path).filter((p) => p.startsWith('/Items?') && !p.includes('Playlist'));
    assert.equal(itemCalls.length, 1);
    assert.ok(!itemCalls[0].includes('ParentId'));
});

test(`${TAG} without the HAPPY plugin the library loads without funscripts`, async () => {
    warnings.length = 0;
    const api = fakeApi(libraryRoutes({ '/Happy/Funscripts': new Response('', { status: 404 }) }));
    const library = await loadLibrary(api, OPTIONS);
    assert.deepEqual(library.videos[0].funscripts, []);
    assert.equal(library.tracks.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /plugin is not installed/);
});

test(`${TAG} a failing funscript listing fails the load`, async () => {
    const api = fakeApi(libraryRoutes({ '/Happy/Funscripts': new Response('', { status: 500 }) }));
    await assert.rejects(loadLibrary(api, OPTIONS), (err: unknown) => {
        assert.ok(err instanceof JellyfinRequestError);
        assert.equal(err.status, 500);
        assert.equal(err.message, 'Funscript listing failed with HTTP 500');
        return true;
    });
});

test(`${TAG} a failing item fetch fails the load`, async () => {
    const route = libraryRoutes();
    const api = fakeApi((path, init) => (path.startsWith('/Items?') && !path.includes('Playlist') ? new Response('', { status: 503 }) : route(path, init)));
    await assert.rejects(loadLibrary(api, OPTIONS), { name: 'Error', message: 'Library fetch failed with HTTP 503' });
});

test(`${TAG} failing playlist requests fail the load`, async () => {
    const route = libraryRoutes();
    const listing = fakeApi((path, init) => (path.includes('IncludeItemTypes=Playlist') ? new Response('', { status: 403 }) : route(path, init)));
    await assert.rejects(loadLibrary(listing, OPTIONS), { message: 'Playlist listing failed with HTTP 403' });

    const entries = fakeApi(libraryRoutes({ '/Playlists/p2/': new Response('', { status: 500 }) }));
    await assert.rejects(loadLibrary(entries, OPTIONS), { message: 'Playlist entries failed with HTTP 500' });
});

test(`${TAG} setFavorite posts to add and deletes to remove, returning Jellyfin's state`, async () => {
    const api = fakeApi((_path, init) => json({ IsFavorite: init?.method === 'POST' }));
    assert.equal(await setFavorite(api, 'item/1', true), true);
    assert.equal(await setFavorite(api, 'item/1', false), false);
    assert.deepEqual(api.calls.map((c) => [c.init?.method, c.path]), [
        ['POST', `/UserFavoriteItems/item%2F1?userId=${encodeURIComponent(USER)}`],
        ['DELETE', `/UserFavoriteItems/item%2F1?userId=${encodeURIComponent(USER)}`],
    ]);
});

test(`${TAG} setFavorite trusts the server's answer over the request`, async () => {
    const api = fakeApi(() => json({ IsFavorite: false }));
    assert.equal(await setFavorite(api, 'x', true), false);
});

test(`${TAG} setFavorite falls back to the requested state without a usable body`, async () => {
    assert.equal(await setFavorite(fakeApi(() => new Response('', { status: 200 })), 'x', true), true);
    assert.equal(await setFavorite(fakeApi(() => new Response(null, { status: 204 })), 'x', false), false);
    assert.equal(await setFavorite(fakeApi(() => json({ IsFavorite: 'yes' })), 'x', true), true);
});

test(`${TAG} setFavorite reports which change failed`, async () => {
    const api = fakeApi(() => new Response('', { status: 500 }));
    await assert.rejects(setFavorite(api, 'x', true), { message: 'Adding a favorite failed with HTTP 500' });
    await assert.rejects(setFavorite(api, 'x', false), { message: 'Removing a favorite failed with HTTP 500' });
});
