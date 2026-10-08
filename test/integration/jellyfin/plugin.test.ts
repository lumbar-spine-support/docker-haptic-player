import test from 'node:test';
import assert from 'node:assert/strict';

import { login, skip, type JellyfinSession } from './session';

interface FunscriptDto {
    Key: string;
    FileName: string;
}

let session: JellyfinSession;
let pluginMissing: string | false = false;

test.before(async () => {
    if (skip) return;
    session = await login('plugin');
    const res = await session.request('/Happy/Info');
    if (res.status === 404) pluginMissing = 'HAPPY plugin is not installed on the Jellyfin server';
});

test.after(async () => {
    await session?.logout();
});

test('[jellyfin-plugin] GET /Happy/Info reports a version', { skip }, async (t) => {
    if (pluginMissing) return t.skip(pluginMissing);
    const res = await session.request('/Happy/Info');
    assert.equal(res.status, 200);
    const { Version } = (await res.json()) as { Version: string };
    assert.match(Version, /^\d+\.\d+\.\d+\.\d+$/);
});

test('[jellyfin-plugin] requires a signed-in user', { skip }, async (t) => {
    if (pluginMissing) return t.skip(pluginMissing);
    for (const path of ['/Happy/Info', '/Happy/Funscripts']) {
        const res = await session.request(path, { anonymous: true });
        assert.equal(res.status, 401, path);
    }
});

test('[jellyfin-plugin] lists funscripts by item id and serves them by key', { skip }, async (t) => {
    if (pluginMissing) return t.skip(pluginMissing);
    const res = await session.request('/Happy/Funscripts');
    assert.equal(res.status, 200);
    const listing = (await res.json()) as Record<string, FunscriptDto[]>;

    const entries = Object.entries(listing);
    if (entries.length === 0) return t.skip('no funscripts in the libraries visible to the test user');

    for (const [itemId, scripts] of entries) {
        assert.match(itemId, /^[0-9a-f]{32}$/);
        assert.ok(scripts.length > 0, 'listed items have at least one script');
        for (const script of scripts) {
            assert.match(script.Key, /^[0-9a-f]{16}$/);
            assert.match(script.FileName, /\.funscript$/i);
            assert.ok(!script.FileName.includes('/'), 'only file names are exposed, never paths');
        }
    }

    // Every listed item must be visible to the user through Jellyfin's own API.
    const [itemId, [first]] = entries[0];
    const item = await session.request(`/Items/${itemId}?userId=${session.userId}`);
    assert.equal(item.status, 200);

    const script = await session.request(`/Happy/Items/${itemId}/Funscripts/${first.Key}`);
    assert.equal(script.status, 200);
    assert.match(String(script.headers.get('content-type')), /application\/json/);
    const json = (await script.json()) as { actions?: unknown };
    assert.ok(Array.isArray(json.actions), 'funscript has an actions array');
});

test('[jellyfin-plugin] unknown items and keys look the same: 404', { skip }, async (t) => {
    if (pluginMissing) return t.skip(pluginMissing);
    const listing = (await (await session.request('/Happy/Funscripts')).json()) as Record<string, FunscriptDto[]>;
    const known = Object.keys(listing)[0];

    const unknownItem = await session.request(`/Happy/Items/${'0'.repeat(31)}1/Funscripts/0000000000000000`);
    assert.equal(unknownItem.status, 404);

    if (known) {
        const unknownKey = await session.request(`/Happy/Items/${known}/Funscripts/ffffffffffffffff`);
        assert.equal(unknownKey.status, 404);
        const traversal = await session.request(`/Happy/Items/${known}/Funscripts/..%2F..%2Fetc%2Fpasswd`);
        assert.equal(traversal.status, 404);
    }
});
