import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { TAG } from '../../src/server/index';
import { startTestServer, httpGet, httpGetBuffer, httpPost } from '../helpers/index';
import type { LibraryResponse } from '../../src/shared/types';
import pkg from '../../package.json';

let testServer: Awaited<ReturnType<typeof startTestServer>>;

test.before(async () => {
    testServer = await startTestServer();
});

test(`${TAG} GET /api/library returns LibraryResponse structure with fixture data`, async () => {
    const { status, body } = await httpGet(testServer.port, '/api/library');
    assert.equal(status, 200, `Expected status 200, got ${status}`);

    const libResponse = body as LibraryResponse;
    assert.ok(Array.isArray(libResponse.tracks), 'response.tracks should be an array');
    assert.ok(Array.isArray(libResponse.videos), 'response.videos should be an array');
    assert.ok(Array.isArray(libResponse.albums), 'response.albums should be an array');
    assert.ok(Array.isArray(libResponse.playlists), 'response.playlists should be an array');
    assert.ok(libResponse.tracks.length > 0, 'Should discover audio fixture files');
    assert.ok(libResponse.videos.length > 0, 'Should discover video fixture files');
});

test(`${TAG} GET /api/library discovers fixture metadata correctly`, async () => {
    const { status, body } = await httpGet(testServer.port, '/api/library');
    assert.equal(status, 200);

    const libResponse = body as LibraryResponse;
    const allMedia = [...libResponse.tracks, ...libResponse.videos];
    const bbMedia = allMedia.find((m) => m.filename.includes('BigBuckBunny'));
    assert.ok(bbMedia, 'Should find Big Buck Bunny media in library');
    assert.ok(bbMedia.title, 'Media should have a title');
    assert.ok(
        typeof bbMedia.durationSeconds === 'number',
        'Media should have numeric duration'
    );
});

test(`${TAG} GET /api/library associates funscripts with media`, async () => {
    const { status, body } = await httpGet(testServer.port, '/api/library');
    assert.equal(status, 200);

    const libResponse = body as LibraryResponse;
    const allMedia = [...libResponse.tracks, ...libResponse.videos];
    const bbMedia = allMedia.find((m) => m.filename.includes('BigBuckBunny'));
    assert.ok(bbMedia, 'Should find Big Buck Bunny');
    assert.ok(bbMedia.funscripts && bbMedia.funscripts.length > 0, 'Should have funscripts');

    const funscriptTypes = new Set(bbMedia.funscripts?.map((f) => f.type) ?? []);
    assert.ok(funscriptTypes.has('buttplug'), 'Should detect buttplug funscript');
    assert.ok(funscriptTypes.has('vibrator'), 'Should detect vibrator funscript');
    assert.ok(funscriptTypes.has('unknown'), 'Should detect suffix-less funscript as generic');
});

test(`${TAG} GET /api/media/:id streams audio file with Accept-Ranges header`, async () => {
    const { status: libStatus, body: libBody } = await httpGet(testServer.port, '/api/library');
    assert.equal(libStatus, 200);

    const libResponse = libBody as LibraryResponse;
    const track = libResponse.tracks.find((t) => t.filename.includes('BigBuckBunny'));
    assert.ok(track, 'Should find BigBuckBunny audio track');

    const { status, headers, text } = await httpGet(testServer.port, `/api/media/${track.id}`);
    assert.equal(status, 200);
    assert.equal(headers['accept-ranges'], 'bytes', 'Should advertise byte range support');
    assert.ok(text.length > 0, 'Should return audio data');
});

test(`${TAG} GET /api/media/:id/description returns markdown without frontmatter`, async () => {
    const { status: libStatus, body: libBody } = await httpGet(testServer.port, '/api/library');
    const libResponse = libBody as LibraryResponse;
    const track = libResponse.tracks.find((t) => t.filename.includes('BigBuckBunny'));
    assert.ok(track, 'Should find BigBuckBunny track');

    const { status, headers, text } = await httpGet(testServer.port, `/api/media/${track.id}/description`);
    assert.equal(status, 200);
    assert.ok(headers['content-type']?.includes('text/markdown'), 'Should return text/markdown content-type');
    assert.ok(!text.startsWith('---'), 'Frontmatter should be stripped');
    assert.ok(text.length > 0, 'Should return description content');
});

test(`${TAG} GET /api/funscript/:trackId/:filename returns JSON for valid funscript`, async () => {
    const { status: libStatus, body: libBody } = await httpGet(testServer.port, '/api/library');
    const libResponse = libBody as LibraryResponse;
    const track = libResponse.tracks.find((t) => t.filename.includes('BigBuckBunny') && (t.funscripts?.length ?? 0) > 0);
    assert.ok(track, 'Should find BigBuckBunny track with funscripts');

    const funscript = track.funscripts?.[0];
    assert.ok(funscript, 'Should have at least one funscript');

    const { status, headers, body } = await httpGet(testServer.port, `/api/funscript/${track.id}/${funscript.filename}`);
    assert.equal(status, 200);
    assert.ok(headers['content-type']?.includes('application/json'), 'Should return application/json');
    assert.ok(body && typeof body === 'object' && 'actions' in body, 'Should return valid JSON with actions');
});

test(`${TAG} GET /api/funscript/:trackId/:filename returns 403 for file not matching patterns`, async () => {
    const { status: libStatus, body: libBody } = await httpGet(testServer.port, '/api/library');
    const libResponse = libBody as LibraryResponse;
    const track = libResponse.tracks.find((t) => t.filename.includes('BigBuckBunny'));
    assert.ok(track, 'Should find BigBuckBunny track');

    const { status, body } = await httpGet(testServer.port, `/api/funscript/${track.id}/BigBuckBunny_320x180.md`);
    assert.equal(status, 403);
    assert.deepEqual(body, { error: 'File does not match configured funscript patterns' });
});

test(`${TAG} GET /api/artwork/:id returns image with correct content-type and caching headers`, async () => {
    const { status: libStatus, body: libBody } = await httpGet(testServer.port, '/api/library');
    const libResponse = libBody as LibraryResponse;
    const track = libResponse.tracks.find((t) => t.filename.includes('BigBuckBunny'));
    assert.ok(track, 'Should find BigBuckBunny track');

    const { status, headers, buffer } = await httpGetBuffer(testServer.port, `/api/artwork/${track.id}`);
    assert.equal(status, 200);
    assert.ok(headers['content-type']?.startsWith('image/'), 'Should return image content-type');
    assert.equal(headers['cache-control'], 'public, max-age=86400, must-revalidate', 'Unversioned URL should revalidate');
    assert.ok(headers['etag'], 'Should set an ETag for conditional requests');
    assert.ok(buffer.length > 0, 'Should return image data');

    const versioned = await httpGetBuffer(testServer.port, `/api/artwork/${track.id}?v=${track.artworkVersion}`);
    assert.equal(versioned.status, 200);
    assert.equal(versioned.headers['cache-control'], 'public, max-age=31536000, immutable', 'Versioned URL should be immutable');
    assert.deepEqual(versioned.buffer, buffer, 'Cached response should match the freshly parsed one');

    const conditional = await httpGetBuffer(testServer.port, `/api/artwork/${track.id}`, {
        headers: { 'If-None-Match': headers['etag'] as string },
    });
    assert.equal(conditional.status, 304, 'Matching ETag should produce a 304');
    assert.equal(conditional.buffer.length, 0, '304 must not carry a body');
});

test(`${TAG} GET /api/library serves a cached index and POST /api/library/refresh rebuilds it`, async () => {
    const cacheFile = path.join(testServer.config.configDir, 'cache', 'library.json');
    assert.ok(fs.existsSync(cacheFile), 'Library index should be persisted under <configDir>/cache');

    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as { fingerprint: string; library: LibraryResponse };
    assert.ok(cached.fingerprint, 'Snapshot should record a media fingerprint');
    assert.ok(cached.library.tracks.length > 0, 'Snapshot should contain the scanned tracks');

    const { status, body } = await httpPost(testServer.port, '/api/library/refresh', {});
    assert.equal(status, 200);
    assert.deepEqual((body as LibraryResponse).tracks, cached.library.tracks, 'Refresh should reproduce the same tracks');
});

test(`${TAG} GET /api/media with path traversal returns 404`, async () => {
    const traversalId = Buffer.from('../../etc/passwd').toString('base64url');
    const { status } = await httpGet(testServer.port, `/api/media/${traversalId}`);
    assert.equal(status, 404, 'Should reject path traversal attempts');
});

test(`${TAG} GET /api/media/:invalidId returns 404 for malformed ID`, async () => {
    const { status } = await httpGet(testServer.port, '/api/media/not-valid-base64!!!');
    assert.ok(status === 400 || status === 404, 'Should reject malformed ID');
});

test(`${TAG} GET /api/version returns the package version by default`, async () => {
    const { status, body: raw } = await httpGet(testServer.port, '/api/version');
    const body = raw as Record<string, unknown>;
    assert.equal(status, 200);
    assert.equal(body.version, pkg.version);
    assert.equal(body.channel, 'stable');
    assert.equal(body.commit, null);
    assert.equal(body.builtAt, null);
});

test(`${TAG} GET /api/config exposes the client config and nothing from the server config`, async () => {
    const { status, body: raw } = await httpGet(testServer.port, '/api/config');
    const body = raw as Record<string, unknown>;
    assert.equal(status, 200);
    assert.equal(body.dglabEnabled, false);
    assert.equal(body.videoSeekInterval, 10);
    for (const secret of ['password', 'mediaDir', 'configDir']) {
        assert.equal(secret in (body as Record<string, unknown>), false, `${secret} must not be exposed`);
    }
});

test(`${TAG} GET /api/config requires authentication`, async () => {
    const { status } = await httpGet(testServer.port, '/api/config', { token: null });
    assert.equal(status, 401);
});

test.after(async () => {
    await testServer.close();
});
