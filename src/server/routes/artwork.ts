import fs from 'fs';
import { Router } from 'express';
import { Config } from '../config';
import { HttpError } from '../utils/errorHandler';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';
import type { ArtworkCache } from '../services/artworkCache';

/** A year, because a versioned URL only ever maps to one image. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Unversioned URLs still revalidate, but the ETag turns that into a 304 instead of a re-send. */
const REVALIDATE_CACHE_CONTROL = 'public, max-age=86400, must-revalidate';

function normalizeImageMime(format: string | undefined): string {
  const lower = (format ?? '').toLowerCase();

  if (lower === 'jpg' || lower === 'jpeg' || lower === 'image/jpg' || lower === 'image/jpeg') {
    return 'image/jpeg';
  }
  if (lower === 'png' || lower === 'image/png') {
    return 'image/png';
  }
  if (lower === 'gif' || lower === 'image/gif') {
    return 'image/gif';
  }
  if (lower === 'webp' || lower === 'image/webp') {
    return 'image/webp';
  }
  if (lower === 'bmp' || lower === 'image/bmp') {
    return 'image/bmp';
  }
  if (lower.startsWith('image/')) {
    return lower;
  }

  return 'application/octet-stream';
}

function detectMimeFromBytes(data: Uint8Array): string | null {
  if (data.length < 4) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif';
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data.length >= 12 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return 'image/webp';
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp';
  return null;
}

export function createArtworkRouter(config: Config.ServerConfig, cache: ArtworkCache): Router {
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

    const cached = cache.read(key);
    if (cached) {
      if (!cached.mime || !cached.data) throw new HttpError(404, 'No artwork');
      res.setHeader('Content-Type', cached.mime);
      res.send(cached.data);
      return;
    }

    const mm = await import('music-metadata');
    const meta = await mm.parseFile(filePath, { duration: false });
    const picture = mm.selectCover(meta.common.picture);

    if (!picture) {
      // Remember the absence too, so art-less files never trigger another full parse.
      cache.write(key, null, null);
      throw new HttpError(404, 'No artwork');
    }

    const mimeFromTag = normalizeImageMime(picture.format);
    const contentType = mimeFromTag !== 'application/octet-stream'
      ? mimeFromTag
      : (detectMimeFromBytes(picture.data) ?? 'image/jpeg');
    const data = Buffer.from(picture.data);

    cache.write(key, contentType, data);
    res.setHeader('Content-Type', contentType);
    res.send(data);
  });

  return router;
}
