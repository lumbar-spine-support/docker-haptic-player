import { Router } from 'express';
import fs from 'fs';
import { Config } from '../config';
import { HttpError } from '../utils/errorHandler';
import { buildFunscriptPatterns, parseFunscriptName } from '../services/libraryService';
import type { AutoFunscriptService } from '../services/autoFunscript';
import type { LibraryIndex } from '../services/libraryIndex';
import { AUTO_FUNSCRIPT_FILENAME } from '../../shared/haptics';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';
import { normalizeRelativePath } from '../utils/paths';

export function createFunscriptRouter(
  config: Config.ServerConfig,
  auto?: { service: AutoFunscriptService; libraryIndex: LibraryIndex },
): Router {
  const router = Router();
  const mediaDir = config.mediaDir;
  const funscriptPatterns = buildFunscriptPatterns(config);

  router.get(`/:trackId/${AUTO_FUNSCRIPT_FILENAME}`, async (req, res) => {
    decodeTrackId(req.params.trackId);
    if (!auto) throw new HttpError(404, 'Auto funscript is disabled');
    const library = await auto.libraryIndex.get();
    const track = [...library.tracks, ...library.videos].find((t) => t.id === req.params.trackId);
    if (!track?.funscripts.some((f) => f.auto)) throw new HttpError(404, 'Auto funscript not available');
    let funscript;
    try {
      funscript = await auto.service.get(track);
    } catch {
      throw new HttpError(422, 'Could not analyse the audio of this file');
    }
    res.json(funscript);
  });

  router.get('/:trackId/:funscriptFilename', (req, res) => {
    decodeTrackId(req.params.trackId);
    const funscriptFilename = normalizeRelativePath(req.params.funscriptFilename);
    const filePath = requireMediaFile(mediaDir, funscriptFilename, 'Funscript not found');

    if (!parseFunscriptName(funscriptFilename, funscriptPatterns, config.funscriptSuffixSeparator)) {
      throw new HttpError(403, 'File does not match configured funscript patterns');
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'application/json');
    res.send(raw);
  });

  return router;
}
