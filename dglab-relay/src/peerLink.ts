// Connection diagnostics for one relay peer. The relay forwards opaque frames and decides nothing
// from these numbers; they only exist so the container log can tell a flaky phone link, a slow
// reverse proxy, a stalled relay and a closed browser tab apart.

import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { createLogger } from './logger';

const log = createLogger('dglab:relay');

/**
 * HAPPY (dglab-kit) sends a JSON `ping` every 2 s and gives up after 3 unanswered ones. A peer that
 * pings and then stays silent this long had its link to the relay stall.
 */
export const SILENCE_WARN_MS = 5_000;
/** A native pong slower than this means the path between the relay and the peer is congested. */
export const SLOW_PONG_MS = 1_000;
/** Bytes queued towards a peer before its link counts as backed up; relayed frames are a few hundred bytes. */
export const BACKLOG_WARN_BYTES = 16 * 1024;

/** Close reasons sent by dglab-kit, which HAPPY uses, explained for the log. */
const KNOWN_REASONS: Record<string, string> = {
  ping_timeout: 'the peer got no pong from the relay for 6 s',
  connect_timeout: 'the peer got no hello from the relay within 8 s',
};

/** Close codes worth a word; see RFC 6455 section 7.4.1. */
const KNOWN_CODES: Record<number, string> = {
  1000: 'normal',
  1001: 'going away',
  1005: 'no status',
  1006: 'abnormal, connection dropped without a close frame',
  1009: 'frame too big',
  1011: 'internal error',
};

/** Client address as the relay sees it, preferring the first `X-Forwarded-For` hop behind a reverse proxy. */
export function remoteAddress(req: IncomingMessage): string {
  const header = req.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms % 60_000) / 1_000)} s`;
}

export function describeClose(code: number, reason: string): string {
  const parts = [`code ${code}${KNOWN_CODES[code] ? ` (${KNOWN_CODES[code]})` : ''}`];
  if (reason) parts.push(`reason "${reason}"${KNOWN_REASONS[reason] ? ` (${KNOWN_REASONS[reason]})` : ''}`);
  return parts.join(', ');
}

/** A close that a healthy peer or the relay itself would not cause. */
function isAbnormalClose(code: number, reason: string): boolean {
  return reason in KNOWN_REASONS || ![1000, 1001, 1005, 4000, 4001, 4002].includes(code);
}

export class PeerLink {
  private readonly connectedAt = Date.now();
  private lastFrameAt = this.connectedAt;
  private framesIn = 0;
  private framesOut = 0;
  /** Set once the peer sends a JSON `ping`; only then is silence a symptom. */
  private pings = false;
  private pingSentAt = 0;
  private backlogged = false;
  /** Why the relay closed this socket itself, if it did. */
  private closedBy: string | null = null;
  missedPongs = 0;

  constructor(readonly name: string, readonly socket: WebSocket, readonly remote: string) { }

  /** Call for every frame the peer sends. */
  received(type: unknown): void {
    const now = Date.now();
    const silence = now - this.lastFrameAt;
    if (this.pings && silence > SILENCE_WARN_MS) {
      log.warn(`${this.name} was silent for ${formatDuration(silence)} although it pings every 2 s; its link to the relay stalled`);
    }
    if (type === 'ping') this.pings = true;
    this.lastFrameAt = now;
    this.framesIn += 1;
  }

  /** Call after relaying a frame to the peer; warns while the outgoing queue keeps growing. */
  sent(): void {
    this.framesOut += 1;
    const queued = this.socket.bufferedAmount;
    if (!this.backlogged && queued > BACKLOG_WARN_BYTES) {
      this.backlogged = true;
      log.warn(`${this.name} is not keeping up: ${Math.round(queued / 1024)} KiB queued towards it`);
    } else if (this.backlogged && queued === 0) {
      this.backlogged = false;
      log.info(`${this.name} caught up with its queue`);
    }
  }

  /** Call right before a native ping goes out. */
  pinged(): void {
    if (this.missedPongs > 0) {
      log.warn(`${this.name} has not answered native pings for ${formatDuration(Date.now() - this.pingSentAt)}`);
    } else {
      this.pingSentAt = Date.now();
    }
    this.missedPongs += 1;
  }

  ponged(): void {
    const rtt = Date.now() - this.pingSentAt;
    if (this.missedPongs > 1) log.info(`${this.name} answers native pings again after ${formatDuration(rtt)}`);
    else if (rtt > SLOW_PONG_MS) log.warn(`${this.name} answered a native ping after ${formatDuration(rtt)}`);
    else log.debug(`${this.name} round trip ${rtt} ms`);
    this.missedPongs = 0;
  }

  /** Records that the relay itself is closing the socket, and why, for the close log. */
  closing(why: string): void {
    this.closedBy ??= why;
  }

  closed(code: number, reason: string): void {
    const now = Date.now();
    const by = this.closedBy ? `closed by the relay (${this.closedBy})` : `closed: ${describeClose(code, reason)}`;
    const message = `${this.name} ${by} after ${formatDuration(now - this.connectedAt)}; `
      + `last frame ${formatDuration(now - this.lastFrameAt)} ago, ${this.framesIn} frames in, ${this.framesOut} out`;
    if (!this.closedBy && isAbnormalClose(code, reason)) log.warn(message);
    else log.info(message);
  }

  error(err: Error): void {
    log.warn(`${this.name} socket error:`, err.message);
  }
}
