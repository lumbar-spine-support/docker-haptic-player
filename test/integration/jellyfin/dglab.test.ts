import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import { login, skip, type JellyfinSession } from './session';
import { createJellyfinTokenVerifier } from '../../../dglab-relay/src/jellyfinAuth';
import { createRelayServer, type RelayServer } from '../../../dglab-relay/src/server';
import { DGLAB_WS_PATH } from '../../../src/shared/dglab';

let session: JellyfinSession;
let relay: RelayServer;
let port: number;

test.before(async () => {
    if (skip) return;
    session = await login('dglab');
    // A real relay that checks tokens with the configured Jellyfin, not a stub.
    relay = createRelayServer(createJellyfinTokenVerifier(String(process.env.HAPPY_JELLYFIN_URL)));
    await new Promise<void>((resolve) => relay.server.listen(0, resolve));
    port = (relay.server.address() as { port: number }).port;
});

test.after(async () => {
    await relay?.close();
    await session?.logout();
});

function connect(token: string): WebSocket {
    return new WebSocket(`ws://localhost:${port}${DGLAB_WS_PATH}`, ['happy', `jellyfin.${token}`]);
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
