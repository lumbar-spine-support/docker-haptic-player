import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { Config } from '../config';
import type { LibraryIndex } from '../services/libraryIndex';
import type { StoryboardService } from '../services/storyboard';
import { buildChaptersVtt, buildStoryboardVtt } from '../../shared/webvtt';
import { HttpError } from '../utils/errorHandler';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const afterOpen = content.slice(3);
  const closeIdx = afterOpen.search(/^---\s*$/m);
  if (closeIdx === -1) return content;
  return afterOpen.slice(closeIdx + 3).replace(/^\r?\n/, '');
}

export function createMediaRouter(config: Config.ServerConfig, libraryIndex: LibraryIndex, storyboards?: StoryboardService): Router {
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

  router.get('/:id/chapters.vtt', async (req, res) => {
    const library = await libraryIndex.get();
    const id = req.params.id;
    const track = library.tracks.find((item) => item.id === id) ?? library.videos.find((item) => item.id === id);
    if (!track?.chapters?.length) throw new HttpError(404, 'Chapters not found');
    res.type('text/vtt; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(buildChaptersVtt(track.chapters));
  });

  // Waits for generation, which also moves this video to the front of the background queue.
  router.get('/:id/storyboard.vtt', async (req, res) => {
    const library = await libraryIndex.get();
    const video = library.videos.find((item) => item.id === req.params.id);
    const meta = video && storyboards ? await storyboards.request(video) : null;
    if (!video || !storyboards || !meta || meta.sheets === 0) throw new HttpError(404, 'Storyboard not found');
    const key = storyboards.key(video);
    res.type('text/vtt; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(buildStoryboardVtt({ ...meta, durationSeconds: video.durationSeconds }, (n) => `storyboard/${key}/${n}.jpg`));
  });

  router.get('/:id/storyboard/:key/:sheet', (req, res) => {
    const match = /^(\d+)\.jpg$/.exec(req.params.sheet);
    const sheetPath = match && storyboards ? storyboards.sheetPath(req.params.key, Number(match[1])) : null;
    if (!sheetPath) throw new HttpError(404, 'Storyboard sheet not found');
    // The key changes with the media file and the generation settings.
    res.sendFile(sheetPath, { maxAge: '1y', immutable: true });
  });

  router.get('/:id', (req, res) => {
    const filename = decodeTrackId(req.params.id);
    const filePath = requireMediaFile(mediaDir, filename);
    res.sendFile(filePath, { headers: { 'Accept-Ranges': 'bytes' } });
  });

  return router;
}
