import express from 'express';
import path from 'path';
import { Config } from './config';
import { errorMiddleware } from './utils/errorHandler';
import { createLibraryRouter } from './routes/library';
import { createMediaRouter } from './routes/media';
import { createArtworkRouter } from './routes/artwork';
import { createFunscriptRouter } from './routes/funscript';

export const TAG = '[server]';

export function createApp(serverConfig?: Config.ServerConfig): express.Express {
  if (!serverConfig) {
    const fullConfig = Config.load();
    serverConfig = fullConfig.server;
  }
  const app = express();
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api/library', createLibraryRouter(serverConfig));
  app.use('/api/media', createMediaRouter(serverConfig));
  app.use('/api/artwork', createArtworkRouter(serverConfig));
  app.use('/api/funscript', createFunscriptRouter(serverConfig));
  app.use(errorMiddleware);
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