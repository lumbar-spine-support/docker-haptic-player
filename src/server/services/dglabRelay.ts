// Dumb passthrough relay implementing the DG-Lab V4 WebSocket wire format.
//
// The relay never parses device commands: it only pairs one controller (the HAPPY
// browser tab) with one or more DG-Lab apps and forwards opaque `data` payloads
// between them. All haptic logic stays in the browser, all safety limits stay in
// the DG-Lab app.

import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { parseCookies } from '../utils/cookies';
import { COOKIE_NAME } from '../middleware/auth';
import { createLogger } from '../utils/logger';
import type { TokenStore } from './tokenStore';

export const TAG = '[dglab]';

const log = createLogger(TAG);

/** Path the relay listens on; anything else is refused at the upgrade handshake. */
export const DGLAB_WS_PATH = '/ws/dglab';

const HEARTBEAT_INTERVAL_MS = 30_000;
/** A controller nobody ever paired with is a forgotten browser tab; reclaim it. */
export const IDLE_TIMEOUT_MS = 5 * 60_000;
const MAX_CONTROLLERS = 8;
const MAX_APPS_PER_CONTROLLER = 4;
/** Guards against a peer streaming junk; real frames are a few hundred bytes. */
const MAX_FRAME_BYTES = 64 * 1024;

export const CLOSE_CONTROLLER_DISCONNECTED = 4000;
export const CLOSE_CONTROLLER_NOT_FOUND = 4001;
export const CLOSE_IDLE_TIMEOUT = 4002;

interface Controller {
  id: string;
  socket: WebSocket;
  apps: Set<string>;
  idleTimer: NodeJS.Timeout | null;
}

interface AppConn {
  id: string;
  socket: WebSocket;
  controllerId: string;
}

export interface DglabRelay {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
  /** Number of currently connected controllers; used by tests and logging. */
  readonly controllerCount: number;
}

function send(socket: WebSocket, frame: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(frame));
}

function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Creates the relay. `tokenStore` is null when authentication is disabled, in
 * which case controllers are accepted without a cookie.
 */
export function createDglabRelay(tokenStore: TokenStore | null): DglabRelay {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const controllers = new Map<string, Controller>();
  const apps = new Map<string, AppConn>();

  const heartbeat = setInterval(() => {
    for (const { socket } of controllers.values()) send(socket, { type: 'heartbeat' });
    for (const { socket } of apps.values()) send(socket, { type: 'heartbeat' });
  }, HEARTBEAT_INTERVAL_MS);
  // The relay must not hold the process open on its own.
  heartbeat.unref?.();

  function armIdleTimer(controller: Controller): void {
    if (controller.idleTimer) clearTimeout(controller.idleTimer);
    controller.idleTimer = setTimeout(() => {
      if (controller.apps.size > 0) return;
      send(controller.socket, { type: 'idle_timeout' });
      controller.socket.close(CLOSE_IDLE_TIMEOUT, 'idle_timeout');
    }, IDLE_TIMEOUT_MS);
    controller.idleTimer.unref?.();
  }

  function dropController(controller: Controller): void {
    if (controller.idleTimer) clearTimeout(controller.idleTimer);
    controllers.delete(controller.id);
    for (const appId of controller.apps) {
      const app = apps.get(appId);
      if (!app) continue;
      apps.delete(appId);
      app.socket.close(CLOSE_CONTROLLER_DISCONNECTED, 'controller_disconnected');
    }
    controller.apps.clear();
  }

  function dropApp(app: AppConn): void {
    apps.delete(app.id);
    const controller = controllers.get(app.controllerId);
    if (!controller) return;
    controller.apps.delete(app.id);
    send(controller.socket, { type: 'client_disconnected', clientId: app.id });
    if (controller.apps.size === 0) armIdleTimer(controller);
  }

  /** Controller -> app. `clientId` selects the target; omitted means broadcast. */
  function relayFromController(controller: Controller, target: unknown, data: unknown): void {
    if (typeof target === 'string' && target.length > 0) {
      const app = apps.get(target);
      if (!app || app.controllerId !== controller.id) {
        send(controller.socket, { type: 'error', code: 'client_not_found', clientId: target });
        return;
      }
      send(app.socket, { type: 'message', clientId: controller.id, data });
      return;
    }
    for (const appId of controller.apps) {
      const app = apps.get(appId);
      if (app) send(app.socket, { type: 'message', clientId: controller.id, data });
    }
  }

  function attachController(socket: WebSocket): void {
    if (controllers.size >= MAX_CONTROLLERS) {
      socket.close(CLOSE_IDLE_TIMEOUT, 'too_many_controllers');
      return;
    }

    // The id doubles as the app's only credential, so it must be unguessable.
    const controller: Controller = { id: crypto.randomUUID(), socket, apps: new Set(), idleTimer: null };
    controllers.set(controller.id, controller);
    send(socket, { type: 'hello', clientId: controller.id });
    armIdleTimer(controller);
    log.debug(`Controller ${controller.id} connected`);

    socket.on('message', (raw) => {
      let frame: { type?: string; clientId?: unknown; data?: unknown };
      try {
        frame = JSON.parse(String(raw));
      } catch {
        send(socket, { type: 'error', code: 'bad_request' });
        return;
      }
      switch (frame.type) {
        case 'message':
          relayFromController(controller, frame.clientId, frame.data);
          break;
        case 'ping':
          send(socket, { type: 'pong', ts: Date.now() });
          break;
        default:
          send(socket, { type: 'error', code: 'bad_request' });
      }
    });

    socket.on('close', () => {
      log.debug(`Controller ${controller.id} disconnected`);
      dropController(controller);
    });
    socket.on('error', () => dropController(controller));
  }

  function attachApp(socket: WebSocket, controllerId: string): void {
    const controller = controllers.get(controllerId);
    if (!controller) {
      socket.close(CLOSE_CONTROLLER_NOT_FOUND, 'controller_not_found');
      return;
    }
    if (controller.apps.size >= MAX_APPS_PER_CONTROLLER) {
      socket.close(CLOSE_CONTROLLER_NOT_FOUND, 'too_many_clients');
      return;
    }

    const app: AppConn = { id: crypto.randomUUID(), socket, controllerId };
    apps.set(app.id, app);
    controller.apps.add(app.id);
    if (controller.idleTimer) clearTimeout(controller.idleTimer);

    send(socket, { type: 'hello', clientId: app.id });
    send(socket, { type: 'controller_attached', clientId: controller.id });
    send(controller.socket, { type: 'client_attached', clientId: app.id });
    log.debug(`App ${app.id} attached to controller ${controller.id}`);

    socket.on('message', (raw) => {
      let frame: { type?: string; data?: unknown };
      try {
        frame = JSON.parse(String(raw));
      } catch {
        send(socket, { type: 'error', code: 'bad_request' });
        return;
      }
      switch (frame.type) {
        case 'message': {
          const target = controllers.get(app.controllerId);
          if (!target) {
            send(socket, { type: 'error', code: 'controller_not_found' });
            return;
          }
          send(target.socket, { type: 'message', clientId: app.id, data: frame.data });
          break;
        }
        case 'ping':
          send(socket, { type: 'pong', ts: Date.now() });
          break;
        default:
          send(socket, { type: 'error', code: 'bad_request' });
      }
    });

    socket.on('close', () => dropApp(app));
    socket.on('error', () => dropApp(app));
  }

  return {
    get controllerCount() { return controllers.size; },

    handleUpgrade(req, socket, head) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== DGLAB_WS_PATH) {
        refuseUpgrade(socket, 404, 'Not Found');
        return;
      }

      const tid = url.searchParams.get('tid');

      // Express middleware never runs on an upgrade, so the token check is hand-rolled here.
      // Apps cannot present a cookie; possession of the unguessable `tid` is their credential.
      if (!tid && tokenStore && !tokenStore.verify(parseCookies(req.headers.cookie)[COOKIE_NAME])) {
        log.debug('Rejected unauthenticated controller upgrade');
        refuseUpgrade(socket, 401, 'Unauthorized');
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        if (tid) attachApp(ws, tid);
        else attachController(ws);
      });
    },

    close() {
      clearInterval(heartbeat);
      for (const controller of [...controllers.values()]) {
        controller.socket.close();
        dropController(controller);
      }
      for (const app of [...apps.values()]) app.socket.close();
      apps.clear();
      wss.close();
    },
  };
}
