import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import { Config } from '../config';

const log = createLogger('dglab:relay');

/** Close codes used by the relay to indicate why a connection was closed. */
export const DGLAB_CLOSE_CODE = {
  CONTROLLER_DISCONNECTED: 4000,
  CONTROLLER_NOT_FOUND: 4001,
  IDLE_TIMEOUT: 4002,
};

/** Interval at which the relay sends heartbeat messages to connected peers.
 * Value taken from: https://github.com/dungeonlab-open/dglab-websocket-server/blob/main/v4-server.ts
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** A controller nobody ever paired with is a forgotten browser tab; reclaim it.
 * Value taken from: https://github.com/dungeonlab-open/dglab-websocket-server/blob/main/v4-server.ts
 */
const IDLE_TIMEOUT_MS = 5 * 60_000;

/**
 * How long paired apps outlive the controller's socket.
 *
 * Switching to the DG-Lab app backgrounds the browser, and mobile Chrome may
 * close the WebSocket while it is hidden. The `tid` the user is about to paste
 * must keep working, and the reconnecting tab picks up whatever attached meanwhile.
 *
 * Note that the grace feature does not exist in reference implementation:
 * https://github.com/dungeonlab-open/dglab-websocket-server/blob/main/v4-server.ts
 */
const DETACH_GRACE_MS = Config.DGLAB_DETACH_GRACE_MS;

/** Guards against a peer streaming junk; real frames are a few hundred bytes. */
const MAX_FRAME_BYTES = 64 * 1024;

interface MessageFrame {
  type?: string;
  clientId?: unknown;
  data?: unknown;
}

function send(socket: WebSocket | null, frame: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(frame));
}

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

/** Parses frames, answers `ping` and malformed input, and hands `message` frames to `onMessage`. */
function listen(socket: WebSocket, onMessage: (frame: MessageFrame) => void): void {
  socket.on('message', (raw) => {
    let frame: MessageFrame;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      send(socket, { type: 'error', code: 'bad_request' });
      return;
    }
    switch (frame.type) {
      case 'message':
        onMessage(frame);
        break;
      case 'ping':
        send(socket, { type: 'pong', ts: Date.now() });
        break;
      default:
        send(socket, { type: 'error', code: 'bad_request' });
    }
  });
}

/**
 * Dumb passthrough relay implementing the DG-Lab V4 WebSocket wire format.
 *
 * The relay never parses device commands: it only pairs the single controller (the
 * HAPPY browser tab) with the single DG-Lab app and forwards opaque `data` payloads
 * between them. All haptic logic stays in the browser, all safety limits stay in
 * the DG-Lab app.
 *
 * HAPPY is single-user, so there is exactly one controller slot and one app slot.
 * Whichever peer connects last owns its slot; the previous one is closed as `replaced`.
 */
export class DglabRelay {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  // Random per process: unguessable because it is the app's only credential.
  private readonly controllerId = crypto.randomUUID();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly graceMs: number;

  /** Null while the tab is away; the app is kept until the grace period runs out. */
  private controller: WebSocket | null = null;
  private app: { id: string; socket: WebSocket } | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;

  /** Expects upgrades already authenticated by the dispatcher; requests with `tid` are apps. */
  constructor(graceMs = DETACH_GRACE_MS) {
    this.graceMs = graceMs;
    this.heartbeat = this.startHeartbeat();
  }

  /** Handles an incoming WebSocket upgrade request after the initial HTTP handshake. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const tid = url.searchParams.get('tid');
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      if (tid) {
        this.attachApp(ws, tid);
      }
      else {
        this.attachController(ws);
      }
    });
  }

  /** Closes the relay and all associated connections. */
  close(): void {
    clearInterval(this.heartbeat);
    this.idleTimer = clearTimer(this.idleTimer);
    this.controller?.close();
    this.controller = null;
    this.dropApp();
    this.wss.close();
  }

  /** Start the heartbeat interval. */
  private startHeartbeat(): NodeJS.Timeout {
    const broadcast = () => {
      send(this.controller, { type: 'heartbeat' });
      send(this.app?.socket ?? null, { type: 'heartbeat' });
    }
    const heartbeat = setInterval(broadcast, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.(); // The heartbeat must not hold the process open on its own.
    return heartbeat;
  }

  /** Attaches a controller, replacing any previous one. */
  private attachController(socket: WebSocket): void {
    this.graceTimer = clearTimer(this.graceTimer);
    const previous = this.controller;
    this.controller = socket;
    previous?.close(DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED, 'replaced');

    send(socket, { type: 'hello', clientId: this.controllerId });
    if (this.app) send(socket, { type: 'client_attached', clientId: this.app.id });
    else this.armIdleTimer();
    log.debug('Controller connected');

    listen(socket, (frame) => this.relayFromController(frame.clientId, frame.data));
    socket.on('close', () => this.detachController(socket));
    socket.on('error', () => this.detachController(socket));
  }

  /** Detaches the controller, starting the grace period for the app. */
  private detachController(socket: WebSocket): void {
    // A newer tab already took the slot.
    if (this.controller !== socket) return;
    this.controller = null;
    this.idleTimer = clearTimer(this.idleTimer);
    clearTimer(this.graceTimer);
    this.graceTimer = setTimeout(() => this.dropApp(), this.graceMs);
    this.graceTimer.unref?.();
    log.debug('Controller detached, holding its app');
  }

  private armIdleTimer(): void {
    clearTimer(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.app) return;
      send(this.controller, { type: 'idle_timeout' });
      this.controller?.close(DGLAB_CLOSE_CODE.IDLE_TIMEOUT, 'idle_timeout');
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  /** Attaches an app, replacing any previous one. */
  private attachApp(socket: WebSocket, tid: string): void {
    // Without a connected or detached controller there is nobody to pair with.
    if (tid !== this.controllerId || (!this.controller && !this.graceTimer)) {
      socket.close(DGLAB_CLOSE_CODE.CONTROLLER_NOT_FOUND, 'controller_not_found');
      return;
    }

    const previous = this.app;
    const id = crypto.randomUUID();
    this.app = { id, socket };
    if (previous) {
      send(this.controller, { type: 'client_disconnected', clientId: previous.id });
      previous.socket.close(DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED, 'replaced');
    }
    this.idleTimer = clearTimer(this.idleTimer);

    send(socket, { type: 'hello', clientId: id });
    send(socket, { type: 'controller_attached', clientId: this.controllerId });
    send(this.controller, { type: 'client_attached', clientId: id });
    log.debug(`App ${id} attached`);

    listen(socket, (frame) => send(this.controller, { type: 'message', clientId: id, data: frame.data }));
    socket.on('close', () => this.detachApp(socket));
    socket.on('error', () => this.detachApp(socket));
  }

  /** Detaches the app, notifying the controller and freeing the slot. */
  private detachApp(socket: WebSocket): void {
    // A newer app connection already took the slot.
    if (this.app?.socket !== socket) return;
    send(this.controller, { type: 'client_disconnected', clientId: this.app.id });
    this.app = null;
    if (this.controller) this.armIdleTimer();
  }

  /** Drops the current app, if any, closing its connection. */
  private dropApp(): void {
    this.graceTimer = clearTimer(this.graceTimer);
    const socket = this.app?.socket;
    this.app = null;
    socket?.close(DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED, 'controller_disconnected');
  }

  /** A `clientId` other than the current app's is stale. */
  private relayFromController(target: unknown, data: unknown): void {
    if (typeof target === 'string' && target.length > 0 && target !== this.app?.id) {
      send(this.controller, { type: 'error', code: 'client_not_found', clientId: target });
      return;
    }
    send(this.app?.socket ?? null, { type: 'message', clientId: this.controllerId, data });
  }
}
