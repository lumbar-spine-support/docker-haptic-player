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

export const TAG = '[server]';

export function createApp(serverConfig?: Config.ServerConfig): express.Express {
  if (!serverConfig) {
    const fullConfig = Config.load();
    serverConfig = fullConfig.server;
  }
  const app = express();
  // Kept configurable so a direct LAN deployment cannot spoof X-Forwarded-* headers.
  app.set('trust proxy', serverConfig.trustProxy);
  const tokenStore = createTokenStore(Config.tokenFilePath(serverConfig.configDir));
  const artworkCache = createArtworkCache(serverConfig.configDir);
  const libraryIndex = createLibraryIndex(serverConfig, artworkCache);
  app.use('/api/auth', createAuthRouter(serverConfig, tokenStore));
  app.use(createAuthMiddleware(serverConfig, tokenStore));
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api/library', createLibraryRouter(libraryIndex));
  app.use('/api/media', createMediaRouter(serverConfig));
  app.use('/api/artwork', createArtworkRouter(serverConfig, artworkCache));
  app.use('/api/funscript', createFunscriptRouter(serverConfig));
  app.use('/api/version', createVersionRouter());
  app.use(errorMiddleware);

  // Pay the scan cost at startup instead of on the first visitor's library request.
  void libraryIndex.get().catch((err) => console.error(`${TAG} Initial library scan failed:`, err));

  return app;
}

function main() {
  const config = Config.load();
  const app = createApp(config.server);
  const port = config.server.port
  app.listen(port, () => {
    console.log(`${TAG} Listening on http://0.0.0.0:${port}`);
  });
}

const isNoTestRun = !process.env.NODE_ENV?.includes('test');
if (isNoTestRun) {
  main();
}