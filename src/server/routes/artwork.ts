import { Router } from 'express';
import { Config } from '../config';
import { HttpError } from '../utils/errorHandler';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';

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

export function createArtworkRouter(config: Config.ServerConfig): Router {
  const router = Router();
  const mediaDir = config.mediaDir;

  router.get('/:id', async (req, res) => {
    const filename = decodeTrackId(req.params.id);
    const filePath = requireMediaFile(mediaDir, filename);

    const mm = await import('music-metadata');
    const meta = await mm.parseFile(filePath, { duration: false });
    const picture = mm.selectCover(meta.common.picture);

    if (!picture) {
      throw new HttpError(404, 'No artwork');
    }

    const mimeFromTag = normalizeImageMime(picture.format);
    const contentType = mimeFromTag !== 'application/octet-stream'
      ? mimeFromTag
      : (detectMimeFromBytes(picture.data) ?? 'image/jpeg');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(picture.data));
  });

  return router;
}
