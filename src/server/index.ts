import express from 'express';
import path from 'path';
import { Config } from './config';
import { errorMiddleware } from './utils/errorHandler';
import { createLibraryRouter } from './routes/library';
import { createMediaRouter } from './routes/media';
import { createArtworkRouter } from './routes/artwork';
import { createFunscriptRouter } from './routes/funscript';
import { createVersionRouter } from './routes/version';
import { createAuthRouter } from './routes/auth';
import { createAuthMiddleware } from './middleware/auth';
import { createTokenStore } from './services/tokenStore';
import { createArtworkCache } from './services/artworkCache';
import { createLibraryIndex } from './services/libraryIndex';
import { logLibrarySummary } from './services/libraryService';
import { createRequestLogger } from './middleware/requestLog';
import { createLogger } from './utils/logger';

export const TAG = '[server]';

const log = createLogger(TAG);

export function createApp(serverConfig?: Config.ServerConfig): express.Express {
  if (!serverConfig) {
    const fullConfig = Config.load();
    serverConfig = fullConfig.server;
  }
  const config = serverConfig;
  const app = express();
  // Kept configurable so a direct LAN deployment cannot spoof X-Forwarded-* headers.
  app.set('trust proxy', config.trustProxy);
  const tokenStore = createTokenStore(Config.tokenFilePath(config.configDir));
  const artworkCache = createArtworkCache(config.configDir);
  const libraryIndex = createLibraryIndex(config, artworkCache);
  app.use(createRequestLogger());
  app.use('/api/auth', createAuthRouter(config, tokenStore));
  app.use(createAuthMiddleware(config, tokenStore));
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api/library', createLibraryRouter(libraryIndex));
  app.use('/api/media', createMediaRouter(config));
  app.use('/api/artwork', createArtworkRouter(config, artworkCache));
  app.use('/api/funscript', createFunscriptRouter(config));
  app.use('/api/version', createVersionRouter());
  app.use(errorMiddleware);

  // Pay the scan cost at startup instead of on the first visitor's library request.
  void libraryIndex.get()
    .then((library) => logLibrarySummary(config, library))
    .catch((err) => log.error('Initial library scan failed:', err));

  return app;
}

function main() {
  const config = Config.load();
  log.info(`Log level is "${config.server.logLevel}"`);
  const app = createApp(config.server);
  const port = config.server.port
  app.listen(port, () => {
    log.info(`Listening on http://0.0.0.0:${port}`);
  });
}

const isNoTestRun = !process.env.NODE_ENV?.includes('test');
if (isNoTestRun) {
  main();
}