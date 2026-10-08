import express from 'express';
import compression from 'compression';
import http from 'http';
import path from 'path';
import Stream from 'stream';
import { Config } from './config';
import { errorMiddleware } from './utils/errorHandler';
import { createVersionRouter } from './routes/version';
import { createConfigRouter } from './routes/config';
import { createDocsRouter } from './routes/docs';
import { createJellyfinTokenVerifier, type TokenVerifier } from './services/jellyfinAuth';
import { DglabRelay } from './services/dglabRelay';
import { createRequestLogger } from './middleware/requestLog';
import { createLogger } from './utils/logger';
import { DGLAB_AUTH_PROTOCOL_PREFIX } from '../shared/dglab';

export const TAG = '[server]';

const log = createLogger(TAG);

/** Express app plus the hooks that live on the HTTP server instead of the request pipeline. */
export interface HappyApp extends express.Express {
  /** Present only while the DG-Lab feature flag is on. */
  dglabRelay?: DglabRelay;
  /** Checks a Jellyfin access token; WebSocket upgrades of signed-in users carry one. */
  verifyJellyfinToken: TokenVerifier;
}

/** Replaceable collaborators, so tests need no real Jellyfin. */
export interface AppDependencies {
  verifyJellyfinToken?: TokenVerifier;
}

export function createApp(serverConfig: Config.ServerConfig, clientConfig?: Config.ClientConfig, deps: AppDependencies = {}): HappyApp {
  if (!serverConfig) {
    const fullConfig = Config.load();
    serverConfig = fullConfig.server;
    clientConfig ??= fullConfig.client;
  }
  const config = serverConfig;
  const client = clientConfig ?? { ...Config.DEFAULT_CLIENT_CONFIG };
  const app = express() as HappyApp;
  // Kept configurable so a direct LAN deployment cannot spoof X-Forwarded-* headers.
  app.set('trust proxy', config.trustProxy);
  // Jellyfin is the only account system; the HAPPY shell, docs and settings defaults hold no media and are public.
  app.verifyJellyfinToken = deps.verifyJellyfinToken
    ?? createJellyfinTokenVerifier(String(config.jellyfinInternalUrl || client.jellyfinUrl));
  app.use(createRequestLogger());
  app.use(compression());
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api/config', createConfigRouter(client));
  app.use('/api/version', createVersionRouter());
  app.use('/api/docs', createDocsRouter(path.join(__dirname, '..', '..', 'docs')));
  // Relative redirects keep working when a reverse proxy serves HAPPY under a sub-path.
  app.get('/docs', (req, res) => {
    res.redirect(`${req.path.endsWith('/') ? '../' : './'}?view=docs&id=index`);
  });
  app.get('/docs/:page', (req, res) => {
    const up = req.path.endsWith('/') ? '../../' : '../';
    res.redirect(`${up}?view=docs&id=${encodeURIComponent(req.params.page)}`);
  });
  app.use(errorMiddleware);

  // Disabled means the endpoint does not exist at all, not that it rejects.
  if (client.dglabEnabled) {
    app.dglabRelay = new DglabRelay();
    log.info('DG-Lab relay enabled.');
  }

  return app;
}

/** Represents a WebSocket upgrade route with a handler.
 * Upgrades from HAPPY tabs are authenticated with the user's Jellyfin token. Browsers cannot set
 * headers on a WebSocket, so the token travels as a subprotocol (`Sec-WebSocket-Protocol`), which
 * keeps it out of URLs and proxy logs.
 * Some clients have no token at all. An example is the Dungeon Lab App, which is only given a
 * WebSocket URL to connect to. That URL includes a `tid` parameter handed out by a HAPPY client
 * (controller), so comparing the `tid` to the stored value authenticates the app; the
 * route-specific handler does that. Such routes declare it with `isPublic`.
 */
interface WebSocketUpgradeRoute {
  handler: (req: http.IncomingMessage, socket: Stream.Duplex, head: Buffer) => void;
  isPublic?: (req: http.IncomingMessage) => boolean;
}

/** The Jellyfin token offered as `jellyfin.<token>` in `Sec-WebSocket-Protocol`, if any. */
export function tokenFromProtocols(header: string | string[] | undefined): string | undefined {
  const offered = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((p) => p.trim());
  return offered.find((p) => p.startsWith(DGLAB_AUTH_PROTOCOL_PREFIX))?.slice(DGLAB_AUTH_PROTOCOL_PREFIX.length);
}

/** Attach WebSocket upgrade handlers for multiple routes.
 *  We don't perform checking for the correctness of the upgrade request inside
 *  the handlers; the correctness is assumed by route matching. E.g.:
 *  - /ws/dglab --> forward upgrade request to `DglabRelay` instance.
 *  - /ws/<other> --> forward upgrade request to the corresponding handler (if any).
 */
export function attachWebSocketUpgradeHandlers(server: http.Server, app: HappyApp): void {
  const parseUrl = (req: http.IncomingMessage): URL => {
    // The Host header is untrusted and may be missing, so a fixed base is used.
    return new URL(req.url ?? '/', 'http://localhost');
  };

  const refuseWebSocketUpgrade = (socket: Stream.Duplex, status: number, reason: string) => {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const routes = new Map<string, WebSocketUpgradeRoute>();

  const relay = app.dglabRelay;
  if (relay) {
    routes.set(Config.DGLAB_WS_PATH, {
      handler: (req, socket, head) => relay.handleUpgrade(req, socket, head),
      isPublic: (req) => parseUrl(req).searchParams.has('tid'),
    });
  }

  server.on('upgrade', (req, socket, head) => {
    const route = routes.get(parseUrl(req).pathname);
    if (!route) {
      return refuseWebSocketUpgrade(socket, 404, 'Not Found');
    }
    if (route.isPublic?.(req)) {
      route.handler(req, socket, head);
      return;
    }
    // Express middleware never runs on upgrades, so auth is enforced here.
    void app.verifyJellyfinToken(tokenFromProtocols(req.headers['sec-websocket-protocol'])).then((valid) => {
      if (socket.destroyed) return;
      if (!valid) return refuseWebSocketUpgrade(socket, 401, 'Unauthorized');
      route.handler(req, socket, head);
    });
  });
}

function main() {
  const config = Config.load();
  log.info(`Log level is "${config.server.logLevel}"`);
  log.debug(`config: ${JSON.stringify(config, null, 2)}`);
  const app = createApp(config.server, config.client);
  const port = config.server.port
  const server = app.listen(port, (err?: Error) => {
    if (err) {
      log.error(`Failed to listen on port ${port}: ${err.message}`);
      process.exit(1);
    }
    log.info(`Listening on http://0.0.0.0:${port}`);
  });
  attachWebSocketUpgradeHandlers(server, app);
}

const isNoTestRun = !process.env.NODE_ENV?.includes('test');
if (isNoTestRun) {
  main();
}