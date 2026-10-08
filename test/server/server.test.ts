import test from 'node:test';
import assert from 'node:assert/strict';

import { TAG } from '../../src/server/index';
import { startTestServer, httpGet } from '../helpers/index';
import pkg from '../../package.json';

let testServer: Awaited<ReturnType<typeof startTestServer>>;

test.before(async () => {
    testServer = await startTestServer();
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
    assert.equal('mediaAccessToken' in body, false, 'remote receivers use the Jellyfin api_key now');
    for (const secret of ['password', 'configDir']) {
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
