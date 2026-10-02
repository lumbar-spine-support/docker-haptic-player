import express from 'express';
import compression from 'compression';
import http from 'http';
import path from 'path';
import Stream from 'stream';
import { Config } from './config';
import { errorMiddleware } from './utils/errorHandler';
import { createLibraryRouter } from './routes/library';
import { createMediaRouter } from './routes/media';
import { createArtworkRouter } from './routes/artwork';
import { createFunscriptRouter } from './routes/funscript';
import { createVersionRouter } from './routes/version';
import { createAuthRouter } from './routes/auth';
import { createConfigRouter } from './routes/config';
import { createDocsRouter } from './routes/docs';
import { createAuthMiddleware, createMediaAccessToken, COOKIE_NAME } from './middleware/auth';
import { createTokenStore, type TokenStore } from './services/tokenStore';
import { createArtworkCache } from './services/artworkCache';
import { createLibraryIndex } from './services/libraryIndex';
import { DglabRelay } from './services/dglabRelay';
import { logLibrarySummary } from './services/libraryService';
import { isFfprobeAvailable } from './services/mediaProbe';
import { createRequestLogger } from './middleware/requestLog';
import { createLogger } from './utils/logger';
import { parseCookies } from './utils/cookies';

export const TAG = '[server]';

const log = createLogger(TAG);

/** Express app plus the hooks that live on the HTTP server instead of the request pipeline. */
export interface HappyApp extends express.Express {
  /** Present only while the DG-Lab feature flag is on. */
  dglabRelay?: DglabRelay;
  tokenStore: TokenStore;
  /** False when no password is set, so WebSocket upgrades need no cookie. */
  requireAuth: boolean;
}

export function createApp(serverConfig: Config.ServerConfig, clientConfig?: Config.ClientConfig): HappyApp {
  if (!serverConfig) {
    const fullConfig = Config.load();
    serverConfig = fullConfig.server;
    clientConfig ??= fullConfig.client;
  }
  const config = serverConfig;
  const client = clientConfig ?? { ...Config.DEFAULT_CLIENT_CONFIG };
  const app = express() as HappyApp;
  const mediaAccessToken = config.password ? createMediaAccessToken() : undefined;
  // Kept configurable so a direct LAN deployment cannot spoof X-Forwarded-* headers.
  app.set('trust proxy', config.trustProxy);
  const tokenStore = createTokenStore(Config.tokenFilePath(config.configDir));
  const artworkCache = createArtworkCache(config.configDir);
  const libraryIndex = createLibraryIndex(config, artworkCache);
  app.tokenStore = tokenStore;
  app.requireAuth = Boolean(config.password);
  app.use(createRequestLogger());
  app.use(compression());
  app.use('/api/auth', createAuthRouter(config, tokenStore));
  app.use(createAuthMiddleware(config, tokenStore, mediaAccessToken));
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api/config', createConfigRouter(client, mediaAccessToken));
  app.use('/api/library', createLibraryRouter(libraryIndex));
  app.use('/api/media', createMediaRouter(config, libraryIndex));
  app.use('/api/artwork', createArtworkRouter(config, artworkCache));
  app.use('/api/funscript', createFunscriptRouter(config));
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

  // Pay the scan cost at startup instead of on the first visitor's library request.
  void libraryIndex.get()
    .then((library) => logLibrarySummary(config, library))
    .catch((err) => log.error('Initial library scan failed:', err));

  return app;
}

/** Represents a WebSocket upgrade route with a handler.
 * Some WebSocket clients may not be able to include cookies for authentication.
 * An example is the Dungeon Lab App, which is only given a WebSocket URL to connect to but not an
 * authentication token.This URL will include a `tid` parameter however that is handed out by a
 * HAPPY client (controller). So comparing the `tid` to the stored value ensures a valid upgrade request,
 * but needs to be dealt with by the route-specific handler.
 * These route-specific authentications are enabled by setting `isPublic` to `true`.
 */
interface WebSocketUpgradeRoute {
  handler: (req: http.IncomingMessage, socket: Stream.Duplex, head: Buffer) => void;
  isPublic?: (req: http.IncomingMessage) => boolean;
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

  const tokenStore = app.tokenStore;
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
    // Express middleware never runs on upgrades, so auth is enforced here.
    const authorized = !app.requireAuth
      || route.isPublic?.(req)
      || tokenStore.verify(parseCookies(req.headers.cookie)[COOKIE_NAME]);
    if (!authorized) {
      return refuseWebSocketUpgrade(socket, 401, 'Unauthorized');
    }
    route.handler(req, socket, head);
  });
}

function main() {
  const config = Config.load();
  log.info(`Log level is "${config.server.logLevel}"`);
  log.debug(`config: ${JSON.stringify(config, null, 2)}`);
  void isFfprobeAvailable().then((ok) => {
    if (!ok) log.error('ffprobe not found on PATH: media metadata, artwork and chapters are unavailable. Install ffmpeg.');
  });
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