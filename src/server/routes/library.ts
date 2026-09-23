import { Router } from 'express';
import type { LibraryIndex } from '../services/libraryIndex';

export function createLibraryRouter(libraryIndex: LibraryIndex): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await libraryIndex.get());
  });

  // Escape hatch for media added over a network share, where mtimes may not reflect the change.
  router.post('/refresh', async (_req, res) => {
    res.json(await libraryIndex.refresh());
  });

  return router;
}
