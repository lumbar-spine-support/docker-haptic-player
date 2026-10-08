import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import { login, skip, type JellyfinSession } from './session';
import { startTestServer } from '../../helpers';
import { Config } from '../../../src/server/config';

let session: JellyfinSession;
let server: Awaited<ReturnType<typeof startTestServer>>;

test.before(async () => {
    if (skip) return;
    session = await login('dglab');
    // A real HAPPY server whose relay checks tokens with the configured Jellyfin, not a stub.
    const { createApp } = await import('../../../src/server/index');
    server = await startTestServer((config) => createApp(config, {
        ...Config.DEFAULT_CLIENT_CONFIG,
        dglabEnabled: true,
        jellyfinUrl: String(process.env.HAPPY_JELLYFIN_URL).replace(/\/+$/, ''),
    }));
});

test.after(async () => {
    await server?.close();
    await session?.logout();
});

function connect(token: string): WebSocket {
    return new WebSocket(`ws://localhost:${server.port}${Config.DGLAB_WS_PATH}`, ['happy', `jellyfin.${token}`]);
}

test('[jellyfin-dglab] the relay accepts a HAPPY tab with a valid Jellyfin token', { skip }, async () => {
    const ws = connect(session.token);
    const hello = await new Promise<{ type: string }>((resolve, reject) => {
        ws.once('message', (raw) => resolve(JSON.parse(String(raw))));
        ws.once('error', reject);
    });
    assert.equal(hello.type, 'hello');
    assert.equal(ws.protocol, 'happy', 'the token is never echoed back');
    ws.close();
});

test('[jellyfin-dglab] the relay rejects a token Jellyfin does not know', { skip }, async () => {
    const ws = connect('ffffffffffffffffffffffffffffffff');
    const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
    assert.match(err.message, /401/);
});
