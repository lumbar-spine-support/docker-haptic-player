import { test } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { DGLAB_DETACH_GRACE_MS, DGLAB_WS_PATH } from '../../src/shared/dglab';
import { setLogLevel } from '../src/logger';
import { DGLAB_CLOSE_CODE, DglabRelay } from '../src/relay';
import { createRelayServer } from '../src/server';

// Every connection is logged at info; peerLink.test.ts covers the wording.
setLogLevel('error');

/** The only token the stub Jellyfin verifier accepts. */
const TEST_JELLYFIN_TOKEN = '0123456789abcdef0123456789abcdef';

const TAG = '[dglab-relay]';

interface Frame { type: string;[key: string]: unknown }

/** HAPPY tabs offer their Jellyfin token as a subprotocol; DG-Lab apps offer none. */
function protocolsFor(token?: string | null): string[] | undefined {
    return token ? ['happy', `jellyfin.${token}`] : undefined;
}

function open(port: number, query: string, token?: string | null): WebSocket {
    return new WebSocket(`ws://localhost:${port}${DGLAB_WS_PATH}${query}`, protocolsFor(token));
}

/** Resolves on the next JSON frame matching `type`, or rejects when the socket closes first. */
function nextFrame(ws: WebSocket, type: string): Promise<Frame> {
    return new Promise((resolve, reject) => {
        const onMessage = (raw: WebSocket.RawData): void => {
            const frame = JSON.parse(String(raw)) as Frame;
            if (frame.type !== type) return;
            ws.off('message', onMessage);
            resolve(frame);
        };
        ws.on('message', onMessage);
        ws.once('close', (code) => reject(new Error(`closed with ${code} before ${type}`)));
        setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 3000).unref();
    });
}

function nextClose(ws: WebSocket): Promise<number> {
    return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

async function withRelay(
    fn: (ctx: { port: number; token: string }) => Promise<void>,
    relay?: DglabRelay,
): Promise<void> {
    const relayServer = createRelayServer(async (token) => token === TEST_JELLYFIN_TOKEN, relay);
    await new Promise<void>((resolve) => relayServer.server.listen(0, resolve));
    const address = relayServer.server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    try {
        await fn({ port: address.port, token: TEST_JELLYFIN_TOKEN });
    } finally {
        await relayServer.close();
    }
}

test(`${TAG} rejects a controller upgrade without a valid token`, async () => {
    await withRelay(async ({ port }) => {
        const ws = open(port, '', null);
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        assert.match(err.message, /401/);
    });
});

test(`${TAG} rejects a controller upgrade with a bogus token`, async () => {
    await withRelay(async ({ port }) => {
        const ws = open(port, '', 'not-a-real-token');
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        assert.match(err.message, /401/);
    });
});

test(`${TAG} refuses upgrades on any other path`, async () => {
    await withRelay(async ({ port, token }) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws/other`, protocolsFor(token));
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        assert.match(err.message, /404/);
    });
});

test(`${TAG} selects the plain protocol and never echoes the token`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        await nextFrame(controller, 'hello');
        assert.equal(controller.protocol, 'happy');
        controller.close();
    });
});

test(`${TAG} greets an authenticated controller with a client id`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const hello = await nextFrame(controller, 'hello');
        assert.equal(typeof hello.clientId, 'string');
        assert.ok((hello.clientId as string).length > 0);
        controller.close();
    });
});

test(`${TAG} hands the same client the same id on every reconnect`, async () => {
    await withRelay(async ({ port, token }) => {
        const first = open(port, '', token);
        const { clientId: before } = await nextFrame(first, 'hello');
        first.close();
        await nextClose(first);

        // A fresh id each time would change the pairing URL and force a re-pair.
        const second = open(port, '', token);
        const { clientId: after } = await nextFrame(second, 'hello');
        assert.equal(after, before);
        second.close();
    });
});

test(`${TAG} lets a second connection from the same client take over its apps`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');
        const app = open(port, `?tid=${tid as string}`, null);
        const { clientId: appId } = await nextFrame(app, 'hello');
        await nextFrame(controller, 'client_attached');

        // Opened while the first is still up, which is what a reconnect after a
        // network blip looks like: the relay has not seen the old socket close yet.
        const reconnected = open(port, '', token);
        const attached = await nextFrame(reconnected, 'client_attached');

        assert.equal(attached.clientId, appId);
        // Superseding the controller must not disconnect the paired app.
        assert.equal(app.readyState, WebSocket.OPEN);

        reconnected.close();
        app.close();
        controller.close();
    });
});

test(`${TAG} lets an app pair while the controller tab is backgrounded`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');

        // Mobile Chrome closes the socket when the user switches to the DG-Lab app.
        controller.close();
        await nextClose(controller);

        const app = open(port, `?tid=${tid as string}`, null);
        const attached = await nextFrame(app, 'controller_attached');
        assert.equal(attached.clientId, tid);

        // Returning to the tab reconnects and picks the app up.
        const resumed = open(port, '', token);
        const seen = await nextFrame(resumed, 'client_attached');
        assert.equal(typeof seen.clientId, 'string');

        resumed.close();
        app.close();
    });
});

test(`${TAG} attaches an app that presents a known tid and notifies both sides`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');

        // The app has no Jellyfin token; possession of the unguessable tid is its only credential.
        const app = open(port, `?tid=${tid as string}`, null);
        // Both listeners have to be armed before awaiting: frames arrive immediately.
        const appAttached = nextFrame(app, 'controller_attached');
        const attached = await nextFrame(controller, 'client_attached');
        const controllerAttached = await appAttached;

        assert.equal(controllerAttached.clientId, tid);
        assert.equal(typeof attached.clientId, 'string');

        controller.close();
        app.close();
    });
});

test(`${TAG} a new app connection replaces the previous one`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');
        const first = open(port, `?tid=${tid as string}`, null);
        await nextFrame(controller, 'client_attached');

        const firstClosed = nextClose(first);
        const second = open(port, `?tid=${tid as string}`, null);
        const { clientId: secondId } = await nextFrame(second, 'hello');
        const attached = await nextFrame(controller, 'client_attached');

        assert.equal(await firstClosed, DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED);
        assert.equal(attached.clientId, secondId);

        second.close();
        controller.close();
    });
});

test(`${TAG} closes an app that presents an unknown tid`, async () => {
    await withRelay(async ({ port }) => {
        const app = open(port, '?tid=00000000-0000-4000-8000-000000000000', null);
        const code = await nextClose(app);
        assert.equal(code, DGLAB_CLOSE_CODE.CONTROLLER_NOT_FOUND);
    });
});

test(`${TAG} relays opaque payloads in both directions, stamping the sender id`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: controllerId } = await nextFrame(controller, 'hello');
        const app = open(port, `?tid=${controllerId as string}`, null);
        const { clientId: appId } = await nextFrame(app, 'hello');
        await nextFrame(controller, 'client_attached');

        controller.send(JSON.stringify({ type: 'message', data: { t: 'req', reqId: 'r1', m: 'devices.get' } }));
        const toApp = await nextFrame(app, 'message');
        assert.equal(toApp.clientId, controllerId);
        assert.deepEqual(toApp.data, { t: 'req', reqId: 'r1', m: 'devices.get' });

        app.send(JSON.stringify({ type: 'message', data: { t: 'resp', reqId: 'r1', result: [] } }));
        const toController = await nextFrame(controller, 'message');
        assert.equal(toController.clientId, appId);
        assert.deepEqual(toController.data, { t: 'resp', reqId: 'r1', result: [] });

        controller.close();
        app.close();
    });
});

test(`${TAG} closes attached apps once the controller's grace period expires`, async () => {
    // A controller that never comes back must not pin its apps open forever.
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');
        const app = open(port, `?tid=${tid as string}`, null);
        await nextFrame(controller, 'client_attached');

        controller.close();
        const code = await nextClose(app);
        assert.equal(code, DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED);
    }, new DglabRelay(50));
});

async function withFastPing(fn: (ctx: { port: number; token: string }) => Promise<void>): Promise<void> {
    await withRelay(fn, new DglabRelay(DGLAB_DETACH_GRACE_MS, 20));
}

test(`${TAG} terminates an app that stops answering native pings`, async () => {
    await withFastPing(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');
        // autoPong off simulates a half-open socket that never answers.
        const app = new WebSocket(`ws://localhost:${port}${DGLAB_WS_PATH}?tid=${tid as string}`, { autoPong: false });
        const { clientId: appId } = await nextFrame(app, 'hello');
        await nextFrame(controller, 'client_attached');

        const gone = await nextFrame(controller, 'client_disconnected');
        assert.equal(gone.clientId, appId);
        controller.close();
    });
});

test(`${TAG} keeps peers that answer native pings`, async () => {
    await withFastPing(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');
        const app = open(port, `?tid=${tid as string}`, null);
        await nextFrame(controller, 'client_attached');

        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(controller.readyState, WebSocket.OPEN);
        assert.equal(app.readyState, WebSocket.OPEN);
        controller.close();
        app.close();
    });
});

test(`${TAG} answers ping with pong`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        await nextFrame(controller, 'hello');
        controller.send(JSON.stringify({ type: 'ping' }));
        const pong = await nextFrame(controller, 'pong');
        assert.equal(typeof pong.ts, 'number');
        controller.close();
    });
});

test(`${TAG} reports bad_request for malformed frames`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        await nextFrame(controller, 'hello');
        controller.send('not json');
        const error = await nextFrame(controller, 'error');
        assert.equal(error.code, 'bad_request');
        controller.close();
    });
});

test(`${TAG} accepts the endpoint under a reverse proxy prefix`, async () => {
    await withRelay(async ({ port, token }) => {
        const controller = new WebSocket(`ws://localhost:${port}/dglab${DGLAB_WS_PATH}`, protocolsFor(token));
        const hello = await nextFrame(controller, 'hello');
        assert.equal(typeof hello.clientId, 'string');
        controller.close();
    });
});

test(`${TAG} answers the health check`, async () => {
    await withRelay(async ({ port }) => {
        const res = await fetch(`http://localhost:${port}/health`);
        assert.equal(res.status, 200);
        assert.equal((await fetch(`http://localhost:${port}/`)).status, 404);
    });
});
