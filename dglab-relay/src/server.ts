import http from 'http';
import type { Duplex } from 'stream';
import { DGLAB_AUTH_PROTOCOL_PREFIX, DGLAB_WS_PATH } from '../../src/shared/dglab';
import type { TokenVerifier } from './jellyfinAuth';
import { DglabRelay } from './relay';

export interface RelayServer {
  server: http.Server;
  relay: DglabRelay;
  close(): Promise<void>;
}

/** The Jellyfin token offered as `jellyfin.<token>` in `Sec-WebSocket-Protocol`, if any. */
export function tokenFromProtocols(header: string | string[] | undefined): string | undefined {
  const offered = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((p) => p.trim());
  return offered.find((p) => p.startsWith(DGLAB_AUTH_PROTOCOL_PREFIX))?.slice(DGLAB_AUTH_PROTOCOL_PREFIX.length);
}

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * HTTP server of the relay: `GET /health` for container health checks and the relay's WebSocket
 * endpoint. The endpoint is any path ending in `/ws/dglab`, so a reverse proxy may forward a
 * prefixed path (`/dglab/ws/dglab`) without rewriting it.
 *
 * HAPPY tabs authenticate with their Jellyfin token, offered as a subprotocol because browsers
 * cannot set headers on a WebSocket; that keeps it out of URLs and proxy logs. The DG-Lab app has
 * no token: it only gets the URL with the controller's unguessable `tid`, which the relay checks.
 */
export function createRelayServer(verifyToken: TokenVerifier, relay = new DglabRelay()): RelayServer {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
  });

  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    // The Host header is untrusted and may be missing, so a fixed base is used.
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.endsWith(DGLAB_WS_PATH)) {
      refuse(socket, 404, 'Not Found');
      return;
    }
    if (url.searchParams.has('tid')) {
      relay.handleUpgrade(req, socket, head);
      return;
    }
    void verifyToken(tokenFromProtocols(req.headers['sec-websocket-protocol'])).then((valid) => {
      if (socket.destroyed) return;
      if (!valid) {
        refuse(socket, 401, 'Unauthorized');
        return;
      }
      relay.handleUpgrade(req, socket, head);
    });
  });

  return {
    server,
    relay,
    close: () => new Promise((resolve) => {
      relay.close();
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
