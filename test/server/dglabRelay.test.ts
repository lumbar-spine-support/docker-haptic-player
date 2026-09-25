import { test } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { startTestServer } from '../helpers';
import {
    CLOSE_CONTROLLER_DISCONNECTED,
    CLOSE_CONTROLLER_NOT_FOUND,
    DGLAB_WS_PATH,
} from '../../src/server/services/dglabRelay';

const TAG = '[server:dglab]';

interface Frame { type: string;[key: string]: unknown }

function open(port: number, query: string, token?: string | null): WebSocket {
    return new WebSocket(`ws://localhost:${port}${DGLAB_WS_PATH}${query}`, {
        headers: token ? { Cookie: `happy_token=${token}` } : {},
    });
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
    createAppFn?: (config: import('../../src/server/config').Config.ServerConfig) => import('../../src/server/index').HappyApp,
): Promise<void> {
    const server = await startTestServer(createAppFn, undefined, { dglabEnabled: true });
    try {
        await fn({ port: server.port, token: server.token });
    } finally {
        await server.close();
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
        const ws = new WebSocket(`ws://localhost:${port}/ws/other`, {
            headers: { Cookie: `happy_token=${token}` },
        });
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        assert.match(err.message, /404/);
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

        // The app has no cookie; possession of the unguessable tid is its only credential.
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

test(`${TAG} closes an app that presents an unknown tid`, async () => {
    await withRelay(async ({ port }) => {
        const app = open(port, '?tid=00000000-0000-4000-8000-000000000000', null);
        const code = await nextClose(app);
        assert.equal(code, CLOSE_CONTROLLER_NOT_FOUND);
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
    const { createApp } = await import('../../src/server/index');
    const { createDglabRelay } = await import('../../src/server/services/dglabRelay');
    const { createTokenStore } = await import('../../src/server/services/tokenStore');
    const { Config } = await import('../../src/server/config');

    // A controller that never comes back must not pin its apps open forever.
    await withRelay(async ({ port, token }) => {
        const controller = open(port, '', token);
        const { clientId: tid } = await nextFrame(controller, 'hello');
        const app = open(port, `?tid=${tid as string}`, null);
        await nextFrame(controller, 'client_attached');

        controller.close();
        const code = await nextClose(app);
        assert.equal(code, CLOSE_CONTROLLER_DISCONNECTED);
    }, (config) => {
        const app = createApp(config, { ...Config.DEFAULT_CLIENT_CONFIG, dglabEnabled: true });
        app.dglabRelay?.close();
        app.dglabRelay = createDglabRelay(createTokenStore(Config.tokenFilePath(config.configDir)), 50);
        return app;
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

test(`${TAG} has no endpoint at all when the feature flag is off`, async () => {
    const server = await startTestServer();
    try {
        const ws = open(server.port, '', server.token);
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        // Express answers the upgrade as a normal request instead of a relay handshake.
        assert.match(err.message, /Unexpected server response/);
    } finally {
        await server.close();
    }
});
