import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { Config } from '../config';
import { HttpError } from '../utils/errorHandler';
import { decodeTrackId, requireMediaFile } from '../utils/mediaFiles';

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const afterOpen = content.slice(3);
  const closeIdx = afterOpen.search(/^---\s*$/m);
  if (closeIdx === -1) return content;
  return afterOpen.slice(closeIdx + 3).replace(/^\r?\n/, '');
}

function findMarkdownByStem(mediaDir: string, targetStem: string): string | null {
  const target = targetStem.toLowerCase();
  const mediaRoot = path.resolve(mediaDir);
  const matches: string[] = [];

  const walk = (currentDir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue;
      if (path.basename(entry.name, '.md').toLowerCase() !== target) continue;
      matches.push(path.relative(mediaRoot, absolute).replace(/\\/g, '/'));
    }
  };

  walk(mediaRoot);
  matches.sort((a, b) => a.localeCompare(b));
  return matches[0] ?? null;
}

export function createMediaRouter(config: Config.ServerConfig): Router {
  const router = Router();
  const mediaDir = config.mediaDir;

  router.get('/:id/description', (req, res) => {
    const filename = decodeTrackId(req.params.id);
    const trackStem = path.basename(filename, path.extname(filename));
    const descriptionFilename = findMarkdownByStem(mediaDir, trackStem);

    if (!descriptionFilename) {
      throw new HttpError(404, 'Description not found');
    }

    const descriptionPath = requireMediaFile(mediaDir, descriptionFilename, 'Description not found');
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
