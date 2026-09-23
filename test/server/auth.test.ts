import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { Config } from '../../src/server/config';
import { createApp } from '../../src/server/index';
import { TAG } from '../../src/server/middleware/auth';
import { startTestServer, httpGet, httpPost, tokenFromSetCookie } from '../helpers/index';

const PASSWORD = Config.DEFAULT_SERVER_CONFIG.password;

let server: Awaited<ReturnType<typeof startTestServer>>;

test.before(async () => {
    server = await startTestServer();
});

test.after(async () => {
    await server.close();
});

test(`${TAG} unauthenticated page request redirects to the login page`, async () => {
    const { status, headers } = await httpGet(server.port, '/', {
        token: null,
        headers: { Accept: 'text/html' },
    });
    assert.equal(status, 302);
    assert.match(String(headers.location), /^\/auth\/\?returnTo=/);
});

test(`${TAG} unauthenticated request never yields the client bundle`, async () => {
    const { status, text } = await httpGet(server.port, '/js/app.js', { token: null });
    assert.ok(status === 302 || status === 401, `Expected a rejection, got ${status}`);
    assert.doesNotMatch(text, /videojs|PlaybackSession/i);
});

test(`${TAG} unauthenticated API request returns 401 JSON`, async () => {
    const { status, body, headers } = await httpGet(server.port, '/api/library', { token: null });
    assert.equal(status, 401);
    assert.deepEqual(body, { error: 'Authentication required' });
    assert.equal(headers['cache-control'], 'no-store');
});

test(`${TAG} login page is reachable without a token`, async () => {
    const { status, text } = await httpGet(server.port, '/auth/', { token: null });
    assert.equal(status, 200);
    assert.match(text, /login-form/);
});

test(`${TAG} themed login stylesheet is not gated by the guard`, async () => {
    // Asserts reachability, not existence: auth.css is a build artifact that CI does not compile.
    const { status } = await httpGet(server.port, '/auth/auth.css', { token: null });
    assert.ok(status !== 401 && status !== 302, `Expected the guard to allow it, got ${status}`);
});

test(`${TAG} the application stylesheet stays behind the guard`, async () => {
    const { status } = await httpGet(server.port, '/css/app.css', { token: null });
    assert.equal(status, 401);
});

test(`${TAG} auth status is reachable without a token`, async () => {
    const { status, body } = await httpGet(server.port, '/api/auth/status', { token: null });
    assert.equal(status, 200);
    assert.deepEqual(body, { required: true, authenticated: false });
});

test(`${TAG} login with a wrong password returns 401`, async () => {
    const { status, body } = await httpPost(server.port, '/api/auth/login', { password: 'wrong' }, { token: null });
    assert.equal(status, 401);
    assert.deepEqual(body, { error: 'Invalid password' });
});

test(`${TAG} login with the correct password sets a hardened cookie`, async () => {
    const { status, headers } = await httpPost(server.port, '/api/auth/login', { password: PASSWORD }, { token: null });
    assert.equal(status, 200);

    const cookie = (headers['set-cookie'] ?? []).find(c => c.startsWith('happy_token='));
    assert.ok(cookie, 'Expected a happy_token cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//i);

    const token = tokenFromSetCookie(headers);
    assert.ok(token);
    const library = await httpGet(server.port, '/api/library', { token });
    assert.equal(library.status, 200);
});

test(`${TAG} a forged token is rejected`, async () => {
    const { status } = await httpGet(server.port, '/api/library', { token: 'not-a-real-token' });
    assert.equal(status, 401);
});

test(`${TAG} seeded token grants access to the API`, async () => {
    const { status } = await httpGet(server.port, '/api/library');
    assert.equal(status, 200);
});

test(`${TAG} deleting the token file revokes sessions without a restart`, async () => {
    const isolated = await startTestServer();
    try {
        assert.equal((await httpGet(isolated.port, '/api/library', { token: isolated.token })).status, 200);
        fs.rmSync(isolated.tokenFile, { force: true });
        assert.equal((await httpGet(isolated.port, '/api/library', { token: isolated.token })).status, 401);
    } finally {
        await isolated.close();
    }
});

test(`${TAG} logout revokes the token and removes it from the file`, async () => {
    const isolated = await startTestServer();
    try {
        const logout = await httpPost(isolated.port, '/api/auth/logout', {}, { token: isolated.token });
        assert.equal(logout.status, 200);
        assert.equal((await httpGet(isolated.port, '/api/library', { token: isolated.token })).status, 401);
        assert.doesNotMatch(fs.readFileSync(isolated.tokenFile, 'utf-8'), new RegExp(isolated.token));
    } finally {
        await isolated.close();
    }
});

test(`${TAG} an empty password disables authentication`, async () => {
    const isolated = await startTestServer(cfg => createApp(cfg), { password: '' });
    try {
        assert.equal((await httpGet(isolated.port, '/api/library', { token: null })).status, 200);
    } finally {
        await isolated.close();
    }
});

test(`${TAG} repeated failed logins are throttled`, async () => {
    const isolated = await startTestServer();
    try {
        for (let attempt = 0; attempt < 5; attempt++) {
            const res = await httpPost(isolated.port, '/api/auth/login', { password: 'wrong' }, { token: null });
            assert.equal(res.status, 401, `Attempt ${attempt + 1} should still be a plain rejection`);
        }

        const blocked = await httpPost(isolated.port, '/api/auth/login', { password: 'wrong' }, { token: null });
        assert.equal(blocked.status, 429);
        assert.ok(Number(blocked.headers['retry-after']) > 0, 'Expected a Retry-After header');

        // Even the correct password stays blocked until the window elapses.
        const stillBlocked = await httpPost(isolated.port, '/api/auth/login', { password: PASSWORD }, { token: null });
        assert.equal(stillBlocked.status, 429);
    } finally {
        await isolated.close();
    }
});

test(`${TAG} a successful login resets the failure counter`, async () => {
    const isolated = await startTestServer();
    try {
        for (let attempt = 0; attempt < 4; attempt++) {
            await httpPost(isolated.port, '/api/auth/login', { password: 'wrong' }, { token: null });
        }
        assert.equal((await httpPost(isolated.port, '/api/auth/login', { password: PASSWORD }, { token: null })).status, 200);

        for (let attempt = 0; attempt < 4; attempt++) {
            const res = await httpPost(isolated.port, '/api/auth/login', { password: 'wrong' }, { token: null });
            assert.equal(res.status, 401, 'Counter should have restarted after the successful login');
        }
    } finally {
        await isolated.close();
    }
});

test(`${TAG} forwarded protocol is ignored when no proxy is trusted`, async () => {
    const isolated = await startTestServer();
    try {
        const { headers } = await httpPost(isolated.port, '/api/auth/login', { password: PASSWORD }, {
            token: null,
            headers: { 'X-Forwarded-Proto': 'https' },
        });
        const cookie = (headers['set-cookie'] ?? []).find(c => c.startsWith('happy_token='));
        assert.ok(cookie);
        assert.doesNotMatch(cookie, /Secure/i, 'A Secure cookie would be dropped over plain HTTP on a LAN');
    } finally {
        await isolated.close();
    }
});

test(`${TAG} forwarded protocol marks the cookie Secure behind a trusted proxy`, async () => {
    const isolated = await startTestServer(cfg => createApp(cfg), { trustProxy: 1 });
    try {
        const { headers } = await httpPost(isolated.port, '/api/auth/login', { password: PASSWORD }, {
            token: null,
            headers: { 'X-Forwarded-Proto': 'https' },
        });
        const cookie = (headers['set-cookie'] ?? []).find(c => c.startsWith('happy_token='));
        assert.ok(cookie);
        assert.match(cookie, /Secure/i);
    } finally {
        await isolated.close();
    }
});
