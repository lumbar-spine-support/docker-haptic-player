import { Router } from 'express';
import { Config } from '../config';
import { lanAddresses } from '../utils/network';

/**
 * Exposes the client-facing half of the configuration.
 *
 * Only `ClientConfig` is served; `ServerConfig` holds filesystem paths and the
 * access password and must never reach the browser. `serverHosts` is runtime
 * information rather than a setting, so it is added here instead of polluting
 * `ClientConfig` and the generated settings file.
 */
export function createConfigRouter(clientConfig: Config.ClientConfig): Router {
  const router = Router();
  const payload = { ...clientConfig, serverHosts: lanAddresses() };

  router.get('/', (_req, res) => {
    res.json(payload);
  });

  return router;
}
