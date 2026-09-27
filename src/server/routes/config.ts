import { Router } from 'express';
import type { Config } from '../config';
import type { ClientSettings } from '../../shared/types';

/** Exposes the server-configured defaults the client falls back to on first run. */
export function createConfigRouter(clientConfig: Config.ClientConfig, mediaAccessToken?: string): Router {
  const router = Router();
  const settings: ClientSettings = {
    videoSeekInterval: Number(clientConfig.videoSeekInterval),
    blurContent: Boolean(clientConfig.blurContent),
    hapticFrequency: Number(clientConfig.hapticFrequency),
    hapticDelay: Number(clientConfig.hapticDelay),
    dglabEnabled: Boolean(clientConfig.dglabEnabled),
    mediaAccessToken: mediaAccessToken ?? null,
  };
  router.get('/', (_req, res) => {
    res.json(settings);
  });
  return router;
}
