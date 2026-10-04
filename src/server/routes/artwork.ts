import fs from 'fs';
import { Router } from 'express';
import { Config } from '../config';
import { HttpError } from '../utils/errorHandler';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';
import type { ArtworkCache } from '../services/artworkCache';
import type { ArtworkResolver } from '../services/artworkResolver';

/** A year, because a versioned URL only ever maps to one image. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Unversioned URLs still revalidate, but the ETag turns that into a 304 instead of a re-send. */
const REVALIDATE_CACHE_CONTROL = 'public, max-age=86400, must-revalidate';

export function createArtworkRouter(config: Config.ServerConfig, cache: ArtworkCache, resolver: ArtworkResolver): Router {
  const router = Router();
  const mediaDir = config.mediaDir;

  router.get('/:id', async (req, res) => {
    const filename = decodeTrackId(req.params.id);
    const filePath = requireMediaFile(mediaDir, filename);

    // The media file's mtime is the cover's version: re-tagging the file invalidates every cached copy.
    const artworkVersion = Math.floor(fs.statSync(filePath).mtimeMs);
    const key = cache.key(req.params.id, artworkVersion);
    const etag = `"${key}"`;
    const cacheControl = req.query.v === undefined ? REVALIDATE_CACHE_CONTROL : IMMUTABLE_CACHE_CONTROL;

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', cacheControl);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const entry = await resolver.resolve(req.params.id, filePath, artworkVersion);
    if (!entry.mime || !entry.data) throw new HttpError(404, 'No artwork');
    res.setHeader('Content-Type', entry.mime);
    res.send(entry.data);
  });

  return router;
}
