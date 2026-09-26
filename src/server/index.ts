import express from 'express';
import http from 'http';
import path from 'path';
import { Config } from './config';
import { errorMiddleware } from './utils/errorHandler';
import { createLibraryRouter } from './routes/library';
import { createMediaRouter } from './routes/media';
import { createArtworkRouter } from './routes/artwork';
import { createFunscriptRouter } from './routes/funscript';
import { createVersionRouter } from './routes/version';
import { createAuthRouter } from './routes/auth';
import { createConfigRouter } from './routes/config';
import { createAuthMiddleware } from './middleware/auth';
import { createTokenStore } from './services/tokenStore';
import { createArtworkCache } from './services/artworkCache';
import { createLibraryIndex } from './services/libraryIndex';
import { createDglabRelay, type DglabRelay } from './services/dglabRelay';
import { logLibrarySummary } from './services/libraryService';
import { createRequestLogger } from './middleware/requestLog';
import { createLogger } from './utils/logger';

export const TAG = '[server]';

const log = createLogger(TAG);

/** Express app plus the hooks that live on the HTTP server instead of the request pipeline. */
export interface HappyApp extends express.Express {
  /** Present only while the DG-Lab feature flag is on. */
  dglabRelay?: DglabRelay;
}

export function createApp(serverConfig: Config.ServerConfig, clientConfig?: Config.ClientConfig): HappyApp {
  if (!serverConfig) {
    const fullConfig = Config.load();
    serverConfig = fullConfig.server;
    clientConfig ??= fullConfig.client;
  }
  const config = serverConfig;
  const client = clientConfig ?? { ...Config.DEFAULT_CLIENT_CONFIG };
  const app: HappyApp = express();
  // Kept configurable so a direct LAN deployment cannot spoof X-Forwarded-* headers.
  app.set('trust proxy', config.trustProxy);
  const tokenStore = createTokenStore(Config.tokenFilePath(config.configDir));
  const artworkCache = createArtworkCache(config.configDir);
  const libraryIndex = createLibraryIndex(config, artworkCache);
  app.use(createRequestLogger());
  app.use('/api/auth', createAuthRouter(config, tokenStore));
  app.use(createAuthMiddleware(config, tokenStore));
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api/config', createConfigRouter(client));
  app.use('/api/library', createLibraryRouter(libraryIndex));
  app.use('/api/media', createMediaRouter(config));
  app.use('/api/artwork', createArtworkRouter(config, artworkCache));
  app.use('/api/funscript', createFunscriptRouter(config));
  app.use('/api/version', createVersionRouter());
  app.use(errorMiddleware);

  // Disabled means the endpoint does not exist at all, not that it rejects.
  if (client.dglabEnabled) {
    app.dglabRelay = createDglabRelay(config.password ? tokenStore : null);
    log.info('DG-Lab relay enabled.');
  }

  // Pay the scan cost at startup instead of on the first visitor's library request.
  void libraryIndex.get()
    .then((library) => logLibrarySummary(config, library))
    .catch((err) => log.error('Initial library scan failed:', err));

  return app;
}

/** Routes WebSocket upgrades to the relay; every other upgrade path is dropped. */
export function attachUpgradeHandlers(server: http.Server, app: HappyApp): void {
  const relay = app.dglabRelay;
  if (!relay) return;
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));
}

function main() {
  const config = Config.load();
  log.info(`Log level is "${config.server.logLevel}"`);
  const app = createApp(config.server, config.client);
  const port = config.server.port
  const server = app.listen(port, () => {
    log.info(`Listening on http://0.0.0.0:${port}`);
  });
  attachUpgradeHandlers(server, app);
}

const isNoTestRun = !process.env.NODE_ENV?.includes('test');
if (isNoTestRun) {
  main();
}