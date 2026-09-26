import test from 'node:test';
import assert from 'node:assert/strict';

import { TAG } from '../../src/server/index';
import { startTestServer, httpGet } from '../helpers/index';

let testServer: Awaited<ReturnType<typeof startTestServer>>;

test.before(async () => {
    testServer = await startTestServer();
});

test.after(async () => {
    await testServer.close();
});

test(`${TAG} GET /api/docs lists the docs pages`, async () => {
    const { status, body } = await httpGet(testServer.port, '/api/docs');
    assert.equal(status, 200);
    const { pages } = body as { pages: string[] };
    assert.ok(pages.includes('index'));
    assert.ok(pages.includes('library'));
});

test(`${TAG} GET /api/docs/:page returns markdown`, async () => {
    const { status, headers, text } = await httpGet(testServer.port, '/api/docs/library');
    assert.equal(status, 200);
    assert.match(String(headers['content-type']), /text\/markdown/);
    assert.match(text, /^# Library Setup/);
});

test(`${TAG} GET /api/docs/:page rejects unknown and malformed pages`, async () => {
    for (const page of ['missing', 'Library', '..%2Fpackage', '..%2F..%2Fpackage.json', 'library.md']) {
        const { status } = await httpGet(testServer.port, `/api/docs/${page}`);
        assert.equal(status, 404, `Expected 404 for ${page}`);
    }
});

test(`${TAG} GET /api/docs/assets serves images only`, async () => {
    const image = await httpGet(testServer.port, '/api/docs/assets/screenshots/library.jpg');
    assert.equal(image.status, 200);
    const markdown = await httpGet(testServer.port, '/api/docs/assets/index.md');
    assert.equal(markdown.status, 404);
    const traversal = await httpGet(testServer.port, '/api/docs/assets/..%2F..%2Fdocs%2Fscreenshots%2Flibrary.jpg');
    assert.notEqual(traversal.status, 200);
});

test(`${TAG} GET /docs/:page redirects to the in-app docs view`, async () => {
    const page = await httpGet(testServer.port, '/docs/library');
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, '../?view=docs&id=library');
    const root = await httpGet(testServer.port, '/docs');
    assert.equal(root.headers.location, './?view=docs&id=index');
    const rootSlash = await httpGet(testServer.port, '/docs/');
    assert.equal(rootSlash.headers.location, '../?view=docs&id=index');
});

test(`${TAG} docs require authentication`, async () => {
    const { status } = await httpGet(testServer.port, '/api/docs/library', { token: null });
    assert.equal(status, 401);
});
