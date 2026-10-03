import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { Config } from '../config';
import type { LibraryIndex } from '../services/libraryIndex';
import { HttpError } from '../utils/errorHandler';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const afterOpen = content.slice(3);
  const closeIdx = afterOpen.search(/^---\s*$/m);
  if (closeIdx === -1) return content;
  return afterOpen.slice(closeIdx + 3).replace(/^\r?\n/, '');
}

export function createMediaRouter(config: Config.ServerConfig, libraryIndex: LibraryIndex): Router {
  const router = Router();
  const mediaDir = config.mediaDir;

  // Generous limit: video seeking issues many range requests.
  router.use(rateLimit({ windowMs: 60_000, limit: 1000, standardHeaders: 'draft-7', legacyHeaders: false }));

  // The library index already matched each file to its .md companion; no directory walk per request.
  router.get('/:id/description', async (req, res) => {
    const library = await libraryIndex.get();
    const id = req.params.id;
    const track = library.tracks.find((item) => item.id === id) ?? library.videos.find((item) => item.id === id);
    if (!track?.descriptionFilename) {
      throw new HttpError(404, 'Description not found');
    }

    const descriptionPath = requireMediaFile(mediaDir, track.descriptionFilename, 'Description not found');
    const body = fs.readFileSync(descriptionPath, 'utf-8');
    res.type('text/markdown; charset=utf-8');
    res.send(stripFrontmatter(body));
  });

  router.get('/:id', (req, res) => {
    const filename = decodeTrackId(req.params.id);
    const filePath = requireMediaFile(mediaDir, filename);
    res.sendFile(filePath, { headers: { 'Accept-Ranges': 'bytes' } });
  });

  return router;
}
