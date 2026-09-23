/**
 * On-disk cache for cover images extracted from media files.
 *
 * Extracting a cover means parsing the container of a possibly multi-gigabyte media file, which is
 * far too expensive to repeat for every `<img>` in a large library. Each cover is therefore written
 * once to `<configDir>/cache/artwork/` and served from there until the media file's mtime changes.
 *
 * Every entry is two files so a cache hit never needs a directory scan:
 *   `<key>.meta` — JSON `{ "mime": "image/jpeg" }`, or `{ "mime": null }` for "this file has no cover"
 *   `<key>.bin`  — the raw image bytes (absent for negative entries)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Config } from '../config';

export const TAG = '[artwork-cache]';

const META_SUFFIX = '.meta';
const DATA_SUFFIX = '.bin';

/** A resolved cache hit. `mime === null` is a negative entry: the media file carries no cover. */
export interface ArtworkCacheEntry {
  mime: string | null;
  data: Buffer | null;
}

export interface ArtworkCache {
  /** Stable cache key and ETag value for a track at a given media-file mtime. */
  key(trackId: string, artworkVersion: number): string;
  read(key: string): ArtworkCacheEntry | null;
  write(key: string, mime: string | null, data: Buffer | null): void;
  /** Drops every entry whose key is no longer referenced by the current library index. */
  prune(validKeys: Set<string>): void;
}

export function createArtworkCache(configDir: string): ArtworkCache {
  const dir = Config.artworkCacheDirPath(configDir);
  let dirReady = false;

  // The cache is best effort: a read-only or full /config mount must not break artwork delivery.
  const ensureDir = (): boolean => {
    if (dirReady) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      dirReady = true;
    } catch (err) {
      console.warn(`${TAG} Cannot create ${dir}; serving artwork without a cache:`, err);
    }
    return dirReady;
  };

  return {
    key(trackId: string, artworkVersion: number): string {
      return crypto.createHash('sha1').update(`${trackId}:${artworkVersion}`).digest('hex');
    },

    read(key: string): ArtworkCacheEntry | null {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, `${key}${META_SUFFIX}`), 'utf-8')) as { mime?: unknown };
        if (meta.mime === null) return { mime: null, data: null };
        if (typeof meta.mime !== 'string') return null;
        return { mime: meta.mime, data: fs.readFileSync(path.join(dir, `${key}${DATA_SUFFIX}`)) };
      } catch {
        return null;
      }
    },

    write(key: string, mime: string | null, data: Buffer | null): void {
      if (!ensureDir()) return;
      try {
        // Bytes first, metadata second: a crash in between leaves an orphan .bin, never a dangling hit.
        if (mime && data) fs.writeFileSync(path.join(dir, `${key}${DATA_SUFFIX}`), data);
        fs.writeFileSync(path.join(dir, `${key}${META_SUFFIX}`), JSON.stringify({ mime: mime ?? null }), 'utf-8');
      } catch (err) {
        console.warn(`${TAG} Failed to cache artwork ${key}:`, err);
      }
    },

    prune(validKeys: Set<string>): void {
      if (!fs.existsSync(dir)) return;
      let removed = 0;
      try {
        for (const name of fs.readdirSync(dir)) {
          if (!name.endsWith(META_SUFFIX) && !name.endsWith(DATA_SUFFIX)) continue;
          if (validKeys.has(name.slice(0, name.lastIndexOf('.')))) continue;
          fs.rmSync(path.join(dir, name), { force: true });
          removed++;
        }
      } catch (err) {
        console.warn(`${TAG} Failed to prune ${dir}:`, err);
        return;
      }
      if (removed > 0) console.debug(`${TAG} Pruned ${removed} stale artwork cache files`);
    },
  };
}
