import { Router } from 'express';
import { Config } from '../config';

/**
 * Exposes the client-facing half of the configuration.
 *
 * Only `ClientConfig` is served; `ServerConfig` holds filesystem paths and the
 * access password and must never reach the browser.
 */
export function createConfigRouter(clientConfig: Config.ClientConfig): Router {
  const router = Router();
  const payload = { ...clientConfig };

  router.get('/', (_req, res) => {
    res.json(payload);
  });

  return router;
}
