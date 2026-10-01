// Dumb passthrough relay implementing the DG-Lab V4 WebSocket wire format.
//
// The relay never parses device commands: it only pairs the single controller (the
// HAPPY browser tab) with one or more DG-Lab apps and forwards opaque `data`
// payloads between them. All haptic logic stays in the browser, all safety limits
// stay in the DG-Lab app.
//
// HAPPY is single-user, so there is exactly one controller slot. Whichever
// authenticated tab connects last owns it; the previous one is closed as `replaced`.

import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { parseCookies } from '../utils/cookies';
import { COOKIE_NAME } from '../middleware/auth';
import { createLogger } from '../utils/logger';
import type { TokenStore } from './tokenStore';


const log = createLogger('dglab:relay');

/** Path the relay listens on; anything else is refused at the upgrade handshake. */
export const DGLAB_WS_PATH = '/ws/dglab';

const HEARTBEAT_INTERVAL_MS = 30_000;
/** A controller nobody ever paired with is a forgotten browser tab; reclaim it. */
export const IDLE_TIMEOUT_MS = 5 * 60_000;
/**
 * How long paired apps outlive the controller's socket.
 *
 * Switching to the DG-Lab app backgrounds the browser, and mobile Chrome may
 * close the WebSocket while it is hidden. The `tid` the user is about to paste
 * must keep working, and the reconnecting tab picks up whatever attached meanwhile.
 */
export const DETACH_GRACE_MS = 5 * 60_000;
const MAX_APPS = 4;
/** Guards against a peer streaming junk; real frames are a few hundred bytes. */
const MAX_FRAME_BYTES = 64 * 1024;

export const CLOSE_CONTROLLER_DISCONNECTED = 4000;
export const CLOSE_CONTROLLER_NOT_FOUND = 4001;
export const CLOSE_IDLE_TIMEOUT = 4002;

export interface DglabRelay {
  /** Handles an incoming WebSocket upgrade request after the initial HTTP handshake. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Closes the relay and all associated connections. */
  close(): void;
}

function send(socket: WebSocket | null, frame: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
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
export function createDglabRelay(tokenStore: TokenStore | null, graceMs = DETACH_GRACE_MS): DglabRelay {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  // Random per process: unguessable because it is the app's only credential.
  const controllerId = crypto.randomUUID();
  /** Null while the tab is away; apps are kept until the grace period runs out. */
  let controller: WebSocket | null = null;
  const apps = new Map<string, WebSocket>();
  let idleTimer: NodeJS.Timeout | null = null;
  let graceTimer: NodeJS.Timeout | null = null;

  const heartbeat = setInterval(() => {
    send(controller, { type: 'heartbeat' });
    for (const app of apps.values()) send(app, { type: 'heartbeat' });
  }, HEARTBEAT_INTERVAL_MS);
  // The relay must not hold the process open on its own.
  heartbeat.unref?.();

  function clearTimer(timer: NodeJS.Timeout | null): null {
    if (timer) clearTimeout(timer);
    return null;
  }

  function armIdleTimer(): void {
    clearTimer(idleTimer);
    idleTimer = setTimeout(() => {
      if (apps.size > 0) return;
      send(controller, { type: 'idle_timeout' });
      controller?.close(CLOSE_IDLE_TIMEOUT, 'idle_timeout');
    }, IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
  }

  function dropApps(): void {
    graceTimer = clearTimer(graceTimer);
    const sockets = [...apps.values()];
    apps.clear();
    for (const app of sockets) app.close(CLOSE_CONTROLLER_DISCONNECTED, 'controller_disconnected');
  }

  function detachController(socket: WebSocket): void {
    // A newer tab already took the slot.
    if (controller !== socket) return;
    controller = null;
    idleTimer = clearTimer(idleTimer);
    clearTimer(graceTimer);
    graceTimer = setTimeout(dropApps, graceMs);
    graceTimer.unref?.();
    log.debug('Controller detached, holding its apps');
  }

  function dropApp(id: string): void {
    if (!apps.delete(id)) return;
    send(controller, { type: 'client_disconnected', clientId: id });
    if (apps.size === 0 && controller) armIdleTimer();
  }

  /** Controller -> app. `clientId` selects the target; omitted means broadcast. */
  function relayFromController(target: unknown, data: unknown): void {
    const frame = { type: 'message', clientId: controllerId, data };
    if (typeof target === 'string' && target.length > 0) {
      const app = apps.get(target);
      if (app) send(app, frame);
      else send(controller, { type: 'error', code: 'client_not_found', clientId: target });
      return;
    }
    for (const app of apps.values()) send(app, frame);
  }

  function attachController(socket: WebSocket): void {
    graceTimer = clearTimer(graceTimer);
    const previous = controller;
    controller = socket;
    previous?.close(CLOSE_CONTROLLER_DISCONNECTED, 'replaced');

    send(socket, { type: 'hello', clientId: controllerId });
    for (const appId of apps.keys()) send(socket, { type: 'client_attached', clientId: appId });
    if (apps.size === 0) armIdleTimer();
    log.debug('Controller connected');

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
          relayFromController(frame.clientId, frame.data);
          break;
        case 'ping':
          send(socket, { type: 'pong', ts: Date.now() });
          break;
        default:
          send(socket, { type: 'error', code: 'bad_request' });
      }
    });

    socket.on('close', () => detachController(socket));
    socket.on('error', () => detachController(socket));
  }

  function attachApp(socket: WebSocket, tid: string): void {
    // Without a connected or detached controller there is nobody to pair with.
    if (tid !== controllerId || (!controller && !graceTimer)) {
      socket.close(CLOSE_CONTROLLER_NOT_FOUND, 'controller_not_found');
      return;
    }
    if (apps.size >= MAX_APPS) {
      socket.close(CLOSE_CONTROLLER_NOT_FOUND, 'too_many_clients');
      return;
    }

    const id = crypto.randomUUID();
    apps.set(id, socket);
    idleTimer = clearTimer(idleTimer);

    send(socket, { type: 'hello', clientId: id });
    send(socket, { type: 'controller_attached', clientId: controllerId });
    send(controller, { type: 'client_attached', clientId: id });
    log.debug(`App ${id} attached`);

    socket.on('message', (raw) => {
      let frame: { type?: string; data?: unknown };
      try {
        frame = JSON.parse(String(raw));
      } catch {
        send(socket, { type: 'error', code: 'bad_request' });
        return;
      }
      switch (frame.type) {
        case 'message':
          send(controller, { type: 'message', clientId: id, data: frame.data });
          break;
        case 'ping':
          send(socket, { type: 'pong', ts: Date.now() });
          break;
        default:
          send(socket, { type: 'error', code: 'bad_request' });
      }
    });

    socket.on('close', () => dropApp(id));
    socket.on('error', () => dropApp(id));
  }

  return {
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
        if (tid) {
          attachApp(ws, tid);
          return;
        }
        attachController(ws);
      });
    },

    close() {
      clearInterval(heartbeat);
      idleTimer = clearTimer(idleTimer);
      controller?.close();
      controller = null;
      dropApps();
      wss.close();
    },
  };
}
