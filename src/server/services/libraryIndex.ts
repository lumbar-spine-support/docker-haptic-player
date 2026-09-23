/**
 * Caching layer in front of `buildLibrary()`.
 *
 * Scanning the media directory means running `music-metadata` over every file, which is far too
 * expensive to repeat on every `GET /api/library`. The built index is therefore held in memory and
 * mirrored to `<configDir>/cache/library.json` so it also survives a restart.
 *
 * Staleness is decided by a fingerprint over the media directory (one `stat` per file) plus the
 * config values that influence the result. The fingerprint is recomputed at most once every
 * `REVALIDATE_INTERVAL_MS`, so a burst of requests costs a single directory walk at worst.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { LibraryResponse } from '../../shared/types';
import { Config } from '../config';
import { buildLibrary, computeMediaFingerprint } from './libraryService';
import type { ArtworkCache } from './artworkCache';
import { createLogger } from '../utils/logger';

export const TAG = '[library-index]';

const log = createLogger(TAG);

/** Bumped whenever the cached JSON shape changes, so old snapshots are discarded instead of trusted. */
const CACHE_FORMAT_VERSION = 2;

const REVALIDATE_INTERVAL_MS = 30_000;

interface Snapshot {
  fingerprint: string;
  library: LibraryResponse;
}

interface CacheFile extends Snapshot {
  version: number;
  builtAt: string;
}

export interface LibraryIndex {
  /** Returns the library, rebuilding it only when the media directory changed. */
  get(): Promise<LibraryResponse>;
  /** Forces a rebuild regardless of the fingerprint. */
  refresh(): Promise<LibraryResponse>;
}

export function createLibraryIndex(config: Config.ServerConfig, artworkCache?: ArtworkCache): LibraryIndex {
  const cacheFile = Config.libraryCacheFilePath(config.configDir);

  let snapshot: Snapshot | null = null;
  let lastValidatedAt = 0;
  let inflight: Promise<LibraryResponse> | null = null;

  /** Config values that change the scan result; folded into the fingerprint so edits invalidate the cache. */
  const configFingerprint = (): string => JSON.stringify([
    path.resolve(config.mediaDir),
    [...config.ignoreExt].map((ext) => ext.toLowerCase()).sort(),
    config.funscriptSuffixSeparator,
    config.funscriptSuffixStroker,
    config.funscriptSuffixButtplug,
    config.funscriptSuffixVibrator,
    config.funscriptSuffixEstim,
    config.funscriptSuffixMachine,
  ]);

  const fingerprint = (): string => crypto.createHash('sha1')
    .update(configFingerprint())
    .update(computeMediaFingerprint(config.mediaDir))
    .digest('hex');

  const readCacheFile = (): Snapshot | null => {
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as Partial<CacheFile>;
      if (parsed.version !== CACHE_FORMAT_VERSION) return null;
      if (typeof parsed.fingerprint !== 'string' || !parsed.library) return null;
      return { fingerprint: parsed.fingerprint, library: parsed.library };
    } catch {
      return null;
    }
  };

  // Best effort: a read-only or full /config mount degrades to an in-memory-only cache.
  const writeCacheFile = (value: Snapshot): void => {
    const payload: CacheFile = { version: CACHE_FORMAT_VERSION, builtAt: new Date().toISOString(), ...value };
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmp, cacheFile);
    } catch (err) {
      log.warn(`Could not persist the library index to ${cacheFile}:`, err);
    }
  };

  const pruneArtwork = (library: LibraryResponse): void => {
    if (!artworkCache) return;
    const keys = new Set<string>();
    for (const track of [...library.tracks, ...library.videos]) {
      keys.add(artworkCache.key(track.id, track.artworkVersion));
    }
    artworkCache.prune(keys);
  };

  const build = (expectedFingerprint: string): Promise<LibraryResponse> => {
    if (inflight) return inflight;
    const started = Date.now();
    inflight = (async () => {
      const library = await buildLibrary(config);
      snapshot = { fingerprint: expectedFingerprint, library };
      lastValidatedAt = Date.now();
      writeCacheFile(snapshot);
      pruneArtwork(library);
      const count = library.tracks.length + library.videos.length;
      log.debug(`Indexed ${count} media files in ${Date.now() - started}ms`);
      return library;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    async get(): Promise<LibraryResponse> {
      if (inflight) return inflight;
      if (snapshot && Date.now() - lastValidatedAt < REVALIDATE_INTERVAL_MS) return snapshot.library;

      const current = fingerprint();
      lastValidatedAt = Date.now();

      if (snapshot) {
        if (snapshot.fingerprint === current) return snapshot.library;
        log.info('Media directory changed; rebuilding index');
        return build(current);
      }

      const persisted = readCacheFile();
      if (persisted && persisted.fingerprint === current) {
        snapshot = persisted;
        log.debug(`Restored library index from ${cacheFile}`);
        return persisted.library;
      }

      return build(current);
    },

    refresh(): Promise<LibraryResponse> {
      return build(fingerprint());
    },
  };
}
