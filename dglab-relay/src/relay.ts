import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from './logger';
import { formatDuration, PeerLink, remoteAddress } from './peerLink';
import { DGLAB_DETACH_GRACE_MS, DGLAB_PROTOCOL } from '../../src/shared/dglab';

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

/** Native ping cadence; half-open sockets never emit `close`, so the relay must probe them.
 * Values taken from: https://github.com/dungeonlab-open/dglab-websocket-server/blob/main/v4-server.ts
 */
const WS_PING_INTERVAL_MS = 10_000;
const MAX_MISSED_PONGS = 3;

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
const DETACH_GRACE_MS = DGLAB_DETACH_GRACE_MS;

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
function listen(link: PeerLink, onMessage: (frame: MessageFrame) => void): void {
  const { socket } = link;
  socket.on('message', (raw) => {
    let frame: MessageFrame;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      link.received(undefined);
      send(socket, { type: 'error', code: 'bad_request' });
      return;
    }
    link.received(frame.type);
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
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    // Select the plain protocol so the token offered next to it is never echoed back.
    handleProtocols: (protocols) => (protocols.has(DGLAB_PROTOCOL) ? DGLAB_PROTOCOL : false),
  });
  // Random per process: unguessable because it is the app's only credential.
  private readonly controllerId = crypto.randomUUID();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly wsPing: NodeJS.Timeout;
  private readonly links = new WeakMap<WebSocket, PeerLink>();
  private readonly graceMs: number;

  /** Null while the tab is away; the app is kept until the grace period runs out. */
  private controller: WebSocket | null = null;
  private app: { id: string; socket: WebSocket } | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private detachedAt = 0;

  /** Expects controller upgrades already authenticated by the dispatcher; requests with `tid` are apps. */
  constructor(graceMs = DETACH_GRACE_MS, pingMs = WS_PING_INTERVAL_MS) {
    this.graceMs = graceMs;
    this.heartbeat = this.startHeartbeat();
    this.wsPing = this.startWsPing(pingMs);
  }

  /** Handles an incoming WebSocket upgrade request after the initial HTTP handshake. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const tid = url.searchParams.get('tid');
    const remote = remoteAddress(req);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      if (tid) {
        this.attachApp(ws, tid, remote);
      }
      else {
        this.attachController(ws, remote);
      }
    });
  }

  /** Closes the relay and all associated connections. */
  close(): void {
    clearInterval(this.heartbeat);
    clearInterval(this.wsPing);
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

  /** Terminates peers that missed too many native pongs; `close` then runs the usual detach path. */
  private startWsPing(intervalMs: number): NodeJS.Timeout {
    const probe = () => {
      for (const ws of [this.controller, this.app?.socket]) {
        const link = ws && this.links.get(ws);
        if (!ws || !link || ws.readyState !== WebSocket.OPEN) continue;
        if (link.missedPongs >= MAX_MISSED_PONGS) {
          link.closing(`missed ${link.missedPongs} native pings`);
          ws.terminate();
          continue;
        }
        link.pinged();
        ws.ping();
      }
    };
    const timer = setInterval(probe, intervalMs);
    timer.unref?.();
    return timer;
  }

  /** Tracks a new peer socket; `onGone` runs once, on close or error. */
  private track(name: string, socket: WebSocket, remote: string, onGone: () => void): PeerLink {
    const link = new PeerLink(name, socket, remote);
    this.links.set(socket, link);
    socket.on('pong', () => link.ponged());
    socket.on('close', (code, reason) => {
      link.closed(code, String(reason));
      onGone();
    });
    socket.on('error', (err) => {
      link.error(err);
      onGone();
    });
    return link;
  }

  /** Closes a peer from the relay's side, noting why for the log. */
  private closePeer(socket: WebSocket, code: number, reason: string): void {
    this.links.get(socket)?.closing(reason);
    socket.close(code, reason);
  }

  /** Relays a frame to a peer, watching for a backlog on the way. */
  private relayTo(socket: WebSocket | null, frame: unknown): void {
    send(socket, frame);
    if (socket) this.links.get(socket)?.sent();
  }

  /** Attaches a controller, replacing any previous one. */
  private attachController(socket: WebSocket, remote: string): void {
    if (this.graceTimer) {
      const away = formatDuration(Date.now() - this.detachedAt);
      log.info(`Controller from ${remote} back after ${away}${this.app ? ', the app stayed paired' : ''}`);
    } else {
      log.info(`Controller connected from ${remote}`);
    }
    this.graceTimer = clearTimer(this.graceTimer);
    const previous = this.controller;
    this.controller = socket;
    if (previous) this.closePeer(previous, DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED, 'replaced');

    const link = this.track('Controller', socket, remote, () => this.detachController(socket));
    listen(link, (frame) => this.relayFromController(frame.clientId, frame.data));

    send(socket, { type: 'hello', clientId: this.controllerId });
    if (this.app) send(socket, { type: 'client_attached', clientId: this.app.id });
    else this.armIdleTimer();
  }

  /** Detaches the controller, starting the grace period for the app. */
  private detachController(socket: WebSocket): void {
    // A newer tab already took the slot.
    if (this.controller !== socket) return;
    this.controller = null;
    this.idleTimer = clearTimer(this.idleTimer);
    clearTimer(this.graceTimer);
    this.detachedAt = Date.now();
    this.graceTimer = setTimeout(() => {
      if (this.app) log.info(`Controller did not come back within ${formatDuration(this.graceMs)}, dropping the app`);
      this.dropApp();
    }, this.graceMs);
    this.graceTimer.unref?.();
    if (this.app) log.info(`Controller gone, keeping the app paired for ${formatDuration(this.graceMs)}`);
  }

  private armIdleTimer(): void {
    clearTimer(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.app) return;
      send(this.controller, { type: 'idle_timeout' });
      if (this.controller) this.closePeer(this.controller, DGLAB_CLOSE_CODE.IDLE_TIMEOUT, 'idle_timeout');
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  /** Attaches an app, replacing any previous one. */
  private attachApp(socket: WebSocket, tid: string, remote: string): void {
    // Without a connected or detached controller there is nobody to pair with.
    if (tid !== this.controllerId || (!this.controller && !this.graceTimer)) {
      log.warn(tid !== this.controllerId
        ? `App from ${remote} presented an unknown pairing id; the relay restarted since pairing, so pair again`
        : `App from ${remote} found no controller; open HAPPY and connect DG-Lab first`);
      socket.close(DGLAB_CLOSE_CODE.CONTROLLER_NOT_FOUND, 'controller_not_found');
      return;
    }

    const previous = this.app;
    const id = crypto.randomUUID();
    this.app = { id, socket };
    log.info(`App ${id.slice(0, 8)} connected from ${remote}${previous ? ', replacing the previous one' : ''}`);
    if (previous) {
      send(this.controller, { type: 'client_disconnected', clientId: previous.id });
      this.closePeer(previous.socket, DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED, 'replaced');
    }
    this.idleTimer = clearTimer(this.idleTimer);

    const link = this.track(`App ${id.slice(0, 8)}`, socket, remote, () => this.detachApp(socket));
    listen(link, (frame) => this.relayTo(this.controller, { type: 'message', clientId: id, data: frame.data }));

    send(socket, { type: 'hello', clientId: id });
    send(socket, { type: 'controller_attached', clientId: this.controllerId });
    send(this.controller, { type: 'client_attached', clientId: id });
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
    if (socket) this.closePeer(socket, DGLAB_CLOSE_CODE.CONTROLLER_DISCONNECTED, 'controller_disconnected');
  }

  /** A `clientId` other than the current app's is stale. */
  private relayFromController(target: unknown, data: unknown): void {
    if (typeof target === 'string' && target.length > 0 && target !== this.app?.id) {
      send(this.controller, { type: 'error', code: 'client_not_found', clientId: target });
      return;
    }
    this.relayTo(this.app?.socket ?? null, { type: 'message', clientId: this.controllerId, data });
  }
}
