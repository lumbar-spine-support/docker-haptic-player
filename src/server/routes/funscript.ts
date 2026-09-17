import { Router } from 'express';
import fs from 'fs';
import { Config } from '../config';
import { HttpError } from '../utils/errorHandler';
import { buildFunscriptPatterns, parseFunscriptName } from '../services/libraryService';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';
import { normalizeRelativePath } from '../utils/paths';

export function createFunscriptRouter(config: Config.ServerConfig): Router {
  const router = Router();
  const mediaDir = config.mediaDir;
  const funscriptPatterns = buildFunscriptPatterns(config);

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
