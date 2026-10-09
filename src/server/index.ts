import express from 'express';
import compression from 'compression';
import path from 'path';
import { Config } from './config';
import { errorMiddleware } from './utils/errorHandler';
import { createVersionRouter } from './routes/version';
import { createConfigRouter } from './routes/config';
import { createDocsRouter } from './routes/docs';
import { createRequestLogger } from './middleware/requestLog';
import { createLogger } from './utils/logger';

export const TAG = '[server]';

const log = createLogger(TAG);

export type HappyApp = express.Express;

export function createApp(serverConfig: Config.ServerConfig, clientConfig?: Config.ClientConfig): HappyApp {
  if (!serverConfig) {
    const fullConfig = Config.load();
    serverConfig = fullConfig.server;
    clientConfig ??= fullConfig.client;
  }
  const config = serverConfig;
  const client = clientConfig ?? { ...Config.DEFAULT_CLIENT_CONFIG };
  const app = express();
  // Kept configurable so a direct LAN deployment cannot spoof X-Forwarded-* headers.
  app.set('trust proxy', config.trustProxy);
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

  return app;
}

function main() {
  const config = Config.load();
  log.info(`Log level is "${config.server.logLevel}"`);
  log.debug(`config: ${JSON.stringify(config, null, 2)}`);
  const app = createApp(config.server, config.client);
  const port = config.server.port
  app.listen(port, (err?: Error) => {
    if (err) {
      log.error(`Failed to listen on port ${port}: ${err.message}`);
      process.exit(1);
    }
    log.info(`Listening on http://0.0.0.0:${port}`);
  });
}

const isNoTestRun = !process.env.NODE_ENV?.includes('test');
if (isNoTestRun) {
  main();
}