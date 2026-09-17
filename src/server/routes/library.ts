import { Router } from 'express';
import { Config } from '../config';
import { buildLibrary } from '../services/libraryService';

export function createLibraryRouter(config: Config.ServerConfig): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await buildLibrary(config));
  });

  return router;
}
