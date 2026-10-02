import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import type { ChapterSource, FunscriptInfo, LibraryResponse, TrackInfo } from '../../shared/types';
import { Config } from '../config';
import { normalizeRelativePath } from '../utils/paths';
import { filenameToId } from '../utils/ids';
import { createLogger } from '../utils/logger';
import { probeMedia, type MediaProbe, type ProbeFn } from './mediaProbe';
import { resolveChapters } from './chapterService';
import { buildAlbums } from './albums';
import { buildPlaylists } from './playlists';
import { FUNSCRIPT_EXT, buildFunscriptIndex, buildFunscriptPatterns, readFunscriptChapters } from './funscripts';

export const TAG = '[library]';

const log = createLogger(TAG);

/** Parse YAML frontmatter tags from a markdown file's content. */
function parseTagsFromMarkdown(content: string): string[] {
  if (!content.startsWith('---')) return [];
  const afterOpen = content.slice(3);
  const closeIdx = afterOpen.search(/^---\s*$/m);
  if (closeIdx === -1) return [];
  const frontmatter = afterOpen.slice(0, closeIdx);
  try {
    const data = yaml.load(frontmatter);
    if (data && typeof data === 'object' && 'tags' in data) {
      const tags = (data as { tags: unknown }).tags;
      if (Array.isArray(tags)) {
        return tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }
  } catch {
    // Ignore malformed frontmatter.
  }
  return [];
}

/** Read the .md companion file (if present) and return the tags from its frontmatter. */
function readDescriptionTags(mediaDir: string, descriptionFilename: string | null): string[] {
  if (!descriptionFilename) return [];
  const descPath = path.join(mediaDir, descriptionFilename);
  if (!fs.existsSync(descPath)) return [];
  try {
    const content = fs.readFileSync(descPath, 'utf-8');
    return parseTagsFromMarkdown(content);
  } catch {
    return [];
  }
}

function readDirectoryDirents(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    log.error(`Failed to read directory ${dir}:`, err);
    return [];
  }
}

function collectFilesRecursively(rootDir: string): string[] {
  return collectFileStats(rootDir).map((entry) => entry.path);
}

/** Relative path plus the stat fields that decide whether the library index is stale. */
export interface MediaFileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

function collectFileStats(rootDir: string): MediaFileStat[] {
  const collected: MediaFileStat[] = [];

  const walk = (currentDir: string): void => {
    for (const dirent of readDirectoryDirents(currentDir)) {
      const absolutePath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!dirent.isFile()) continue;
      let size = 0;
      let mtimeMs = 0;
      try {
        const stats = fs.statSync(absolutePath);
        size = stats.size;
        mtimeMs = Math.floor(stats.mtimeMs);
      } catch {
        // Unreadable entry: treat as empty so it still participates in the fingerprint.
      }
      collected.push({ path: normalizeRelativePath(path.relative(rootDir, absolutePath)), size, mtimeMs });
    }
  };

  walk(rootDir);
  return collected.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Cheap content signature of the media directory: one stat per file, no metadata parsing.
 * Any rename, resize or touch changes the digest and therefore invalidates the library index.
 */
export function computeMediaFingerprint(mediaDir: string): string {
  if (!fs.existsSync(mediaDir)) return 'missing';
  const hash = crypto.createHash('sha1');
  for (const entry of collectFileStats(mediaDir)) {
    hash.update(`${entry.path}\0${entry.size}\0${entry.mtimeMs}\n`);
  }
  return hash.digest('hex');
}

function basenameStem(filename: string): string {
  const base = path.basename(filename);
  const ext = path.extname(base);
  return base.slice(0, base.length - ext.length).toLowerCase();
}

function buildDescriptionIndex(allFiles: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const filename of allFiles) {
    if (path.extname(filename).toLowerCase() !== '.md') continue;
    const key = basenameStem(filename);
    const bucket = index.get(key) ?? [];
    bucket.push(filename);
    index.set(key, bucket);
  }

  for (const bucket of index.values()) {
    bucket.sort((a, b) => a.localeCompare(b));
  }

  return index;
}

function toWholeSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

export function parseTrackNumber(track: unknown): number | null {
  if (typeof track === 'number' && Number.isFinite(track)) {
    return Math.trunc(track);
  }
  if (typeof track === 'string') {
    const trimmed = track.trim();
    if (!trimmed) return null;
    const value = Number.parseInt(trimmed, 10);
    return Number.isFinite(value) ? value : null;
  }
  if (track && typeof track === 'object') {
    const candidate = 'no' in track ? (track as { no?: unknown }).no : undefined;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.trunc(candidate);
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) return null;
      const value = Number.parseInt(trimmed, 10);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

/** Parse metadata for a list of media filenames and build TrackInfo entries for them. */
async function buildMediaEntries(
  mediaDir: string,
  filenames: string[],
  type: 'audio' | 'video',
  descriptionsByStem: Map<string, string[]>,
  funscriptsByStem: Map<string, FunscriptInfo[]>,
  chapterPriority: readonly ChapterSource[],
  probe: ProbeFn,
): Promise<TrackInfo[]> {
  const entries: TrackInfo[] = [];

  for (const filename of filenames) {
    const filePath = path.join(mediaDir, filename);
    const stem = basenameStem(filename);
    const descriptionFilename = descriptionsByStem.get(stem)?.[0] ?? null;
    const funscripts = funscriptsByStem.get(stem) ?? [];

    let meta: MediaProbe | null = null;
    try {
      meta = await probe(filePath);
    } catch (err) {
      log.debug(`Could not probe ${filename}:`, err);
    }
    const tags = meta?.tags ?? {};
    const durationSeconds = toWholeSeconds(meta?.durationSeconds);

    let artworkVersion = 0;
    try {
      artworkVersion = Math.floor(fs.statSync(filePath).mtimeMs);
    } catch {
      // Unreadable stat only costs us cache-busting precision.
    }

    const resolved = resolveChapters(chapterPriority, {
      embedded: () => meta?.chapters ?? [],
      funscript: () => readFunscriptChapters(mediaDir, filename, funscripts),
    }, meta?.durationSeconds ?? 0);

    entries.push({
      id: filenameToId(filename),
      type,
      filename,
      descriptionFilename,
      title: tags.title ?? path.basename(filename, path.extname(filename)),
      artist: tags.artist ?? '',
      album: tags.album ?? '',
      year: tags.year ?? '',
      trackNumber: parseTrackNumber(tags.track),
      comment: tags.comment ?? '',
      hasArtwork: meta?.hasArtwork ?? false,
      artworkVersion,
      durationSeconds,
      funscripts,
      tags: readDescriptionTags(mediaDir, descriptionFilename),
      ...(resolved ? { chapters: resolved.chapters, chaptersSource: resolved.source } : {}),
    });
  }

  return entries;
}

/** Build the full library by scanning the media directory. */
export async function buildLibrary(config: Config.ServerConfig, probe: ProbeFn = probeMedia): Promise<LibraryResponse> {
  const MEDIA_DIR = config.mediaDir;

  if (!fs.existsSync(MEDIA_DIR)) {
    log.warn(`Media directory not found: ${MEDIA_DIR}`);
    return { tracks: [], videos: [], albums: [], playlists: [] };
  }

  const allFiles = collectFilesRecursively(MEDIA_DIR);
  const descriptionsByStem = buildDescriptionIndex(allFiles);
  const funscriptPatterns = buildFunscriptPatterns(config);
  const funscriptsByStem = buildFunscriptIndex(allFiles, funscriptPatterns, config.funscriptSuffixSeparator);
  const playlistFiles = allFiles.filter((entry) => path.extname(entry).toLowerCase() === '.m3u');
  const chapterPriority = config.chapterSourcePriority as ChapterSource[];

  const ignoredExts = new Set(config.ignoreExt.map((ext) => ext.toLowerCase()));
  const supportedExts = new Set(
    [...Config.VIDEO_EXTENSIONS, ...Config.AUDIO_EXTENSIONS]
      .map((ext) => ext.toLowerCase())
      .filter((ext) => !ignoredExts.has(ext))
  );
  const normalizedVideoExts = new Set(Config.VIDEO_EXTENSIONS.map((ext) => ext.toLowerCase()));

  const supportedFiles = allFiles
    .filter((entry) => {
      const ext = path.extname(entry).toLowerCase().replace('.', '');
      if (!supportedExts.has(ext)) return false;
      const fullPath = path.join(MEDIA_DIR, entry);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
    })
    .sort((a, b) => a.localeCompare(b));

  const audioFiles = supportedFiles.filter((entry) => !normalizedVideoExts.has(path.extname(entry).toLowerCase().replace('.', '')));
  const videoFiles = supportedFiles.filter((entry) => normalizedVideoExts.has(path.extname(entry).toLowerCase().replace('.', '')));

  const tracks = await buildMediaEntries(MEDIA_DIR, audioFiles, 'audio', descriptionsByStem, funscriptsByStem, chapterPriority, probe);
  const videos = await buildMediaEntries(MEDIA_DIR, videoFiles, 'video', descriptionsByStem, funscriptsByStem, chapterPriority, probe);

  const allMedia = [...tracks, ...videos];
  const playlists = buildPlaylists(MEDIA_DIR, allMedia, playlistFiles);

  return {
    tracks,
    videos,
    albums: buildAlbums(allMedia),
    playlists,
  };
}

/** Everything in the media directory that is neither playable media nor a companion file. */
function classifyIgnored(filename: string, ignoredExts: Set<string>): string {
  const ext = path.extname(filename).toLowerCase();
  const bare = ext.replace('.', '');
  if (ignoredExts.has(bare)) return `IGNORE_EXT (.${bare})`;
  if (ext === FUNSCRIPT_EXT) return 'funscript without media';
  if (ext === '.md') return 'description without media';
  if (ext === '.m3u') return 'unreadable playlist';
  return `unsupported extension (${ext || 'none'})`;
}

/**
 * One-line inventory of the media directory, plus a per-file breakdown on debug level.
 * Walks the directory again (stat only, no metadata parsing) so it also works for a library
 * that was restored from the cache instead of freshly scanned.
 */
export function logLibrarySummary(config: Config.ServerConfig, library: LibraryResponse): void {
  const mediaDir = config.mediaDir;
  if (!fs.existsSync(mediaDir)) {
    log.warn(`Media directory not found: ${mediaDir}`);
    return;
  }

  const media = [...library.tracks, ...library.videos];
  const known = new Set<string>();
  for (const entry of media) {
    known.add(entry.filename);
    if (entry.descriptionFilename) known.add(entry.descriptionFilename);
    for (const funscript of entry.funscripts) known.add(funscript.filename);
  }
  for (const playlist of library.playlists) known.add(playlist.filename);

  const ignoredExts = new Set(config.ignoreExt.map((ext) => ext.toLowerCase()));
  const ignored = collectFilesRecursively(mediaDir).filter((entry) => !known.has(entry));
  const audioCount = media.filter((entry) => entry.type === 'audio').length;
  const videoCount = media.length - audioCount;
  const withFunscript = media.filter((entry) => entry.funscripts.length > 0).length;

  log.info(
    `Scanned ${mediaDir}: ${media.length} media files (${audioCount} audio, ${videoCount} video), `
    + `${withFunscript} with funscripts, ${library.playlists.length} playlists, ${ignored.length} ignored files`
  );

  if (!log.isDebug()) return;

  for (const entry of media) {
    const scripts = entry.funscripts.length > 0
      ? `funscripts: ${entry.funscripts.map((f) => (f.sub ? `${f.type}/${f.sub}` : f.type)).join(', ')}`
      : 'no funscript';
    log.debug(`  ${entry.type} ${entry.filename} (${scripts})`);
  }
  for (const entry of ignored) {
    log.debug(`  ignored ${entry} (${classifyIgnored(entry, ignoredExts)})`);
  }
}
