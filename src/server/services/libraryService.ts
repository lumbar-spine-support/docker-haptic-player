import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import type { AlbumInfo, FunscriptInfo, FunscriptType, LibraryResponse, PlaylistEntry, PlaylistInfo, TrackInfo } from '../../shared/types';
import { Config } from '../config';
import { normalizeRelativePath } from '../utils/paths';

// Funscript type → suffix mapping used for discovery.
export function buildFunscriptPatterns(config: Config.ServerConfig): Array<{ type: FunscriptType; suffix: string }> {
  return [
    { type: 'stroker', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixStroker}.funscript` },
    { type: 'buttplug', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixButtplug}.funscript` },
    { type: 'vibrator', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixVibrator}.funscript` },
    { type: 'estim', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixEstim}.funscript` },
    { type: 'machine', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixMachine}.funscript` },
  ];
}

const FUNSCRIPT_EXT = '.funscript';

/**
 * Split a funscript file name into media stem, type and optional subcategory.
 *
 * Accepts `<stem><sep><type>.funscript` and `<stem><sep><type><sep><sub>.funscript`,
 * so the same type can appear several times per track (e.g. estim for nipples and butt).
 * Names without a recognised type suffix fall back to the `unknown` ("Generic") type,
 * with the whole basename treated as the media stem.
 */
export function parseFunscriptName(
  filename: string,
  patterns: Array<{ type: FunscriptType; suffix: string }>,
  separator: string,
): { stem: string; type: FunscriptType; sub?: string } | null {
  const base = path.basename(filename);
  const lower = base.toLowerCase();
  if (!lower.endsWith(FUNSCRIPT_EXT)) return null;

  const body = lower.slice(0, lower.length - FUNSCRIPT_EXT.length);
  const untyped = { stem: body, type: 'unknown' as FunscriptType };
  const typeBySuffix = new Map(
    patterns.map((p) => [p.suffix.slice(separator.length, p.suffix.length - FUNSCRIPT_EXT.length), p.type]),
  );

  const lastSep = body.lastIndexOf(separator);
  if (lastSep <= 0) return untyped;

  const lastToken = body.slice(lastSep + separator.length);
  const directType = typeBySuffix.get(lastToken);
  if (directType) return { stem: body.slice(0, lastSep), type: directType };

  const prevSep = body.lastIndexOf(separator, lastSep - 1);
  if (prevSep <= 0) return untyped;
  const type = typeBySuffix.get(body.slice(prevSep + separator.length, lastSep));
  if (!type) return untyped;

  // Keep the author's casing for the subcategory; it is user-facing.
  const sub = base.slice(lastSep + separator.length, base.length - FUNSCRIPT_EXT.length);
  return { stem: body.slice(0, prevSep), type, sub };
}

/** Derive a stable, URL-safe ID from a filename. */
export function filenameToId(filename: string): string {
  return Buffer.from(filename).toString('base64url');
}

/** Reverse of filenameToId. */
export function idToFilename(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf-8');
}

function playlistIdFromFilename(filename: string): string {
  return filenameToId(`playlist:${filename}`);
}

function albumIdFromName(album: string, artist: string): string {
  return filenameToId(`album:${artist}\u0000${album}`);
}

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
    console.error(`[library] Failed to read directory ${dir}:`, err);
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

function parsePlaylist(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function normalizePlaylistTarget(targetPath: string): string {
  return targetPath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
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

function buildFunscriptIndex(
  allFiles: string[],
  patterns: Array<{ type: FunscriptType; suffix: string }>,
  separator: string,
): Map<string, FunscriptInfo[]> {
  const index = new Map<string, FunscriptInfo[]>();

  for (const filename of allFiles) {
    const parsed = parseFunscriptName(filename, patterns, separator);
    if (!parsed) continue;

    const bucket = index.get(parsed.stem) ?? [];
    bucket.push(parsed.sub ? { type: parsed.type, filename, sub: parsed.sub } : { type: parsed.type, filename });
    index.set(parsed.stem, bucket);
  }

  for (const bucket of index.values()) {
    bucket.sort((a, b) => a.filename.localeCompare(b.filename));
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

function compareTrackEntries(a: TrackInfo, b: TrackInfo): number {
  const aTrackNumber = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
  const bTrackNumber = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
  if (aTrackNumber !== bTrackNumber) return aTrackNumber - bTrackNumber;

  const yearCmp = a.year.localeCompare(b.year);
  if (yearCmp !== 0) return yearCmp;

  const titleCmp = a.title.localeCompare(b.title);
  if (titleCmp !== 0) return titleCmp;

  return a.filename.localeCompare(b.filename);
}

function buildAlbums(tracks: TrackInfo[]): AlbumInfo[] {
  const albumMap = new Map<string, TrackInfo[]>();

  for (const track of tracks) {
    if (!track.album.trim()) continue;
    const key = `${track.artist}\u0000${track.album}`;
    const bucket = albumMap.get(key) ?? [];
    bucket.push(track);
    albumMap.set(key, bucket);
  }

  return [...albumMap.entries()]
    .map(([key, albumTracks]) => {
      const [artist, album] = key.split('\u0000');
      const sortedTracks = [...albumTracks].sort(compareTrackEntries);
      // Only tracks that actually carry a cover; otherwise the client would request a guaranteed 404.
      const coverTrack = sortedTracks.find((track) => track.hasArtwork) ?? null;

      return {
        id: albumIdFromName(album, artist),
        type: 'album',
        album,
        artist,
        year: sortedTracks[0]?.year ?? '',
        durationSeconds: sortedTracks.reduce((sum, track) => sum + track.durationSeconds, 0),
        title: album,
        trackIds: sortedTracks.map((track) => track.id),
        trackCount: sortedTracks.length,
        coverTrackId: coverTrack?.id ?? null,
      } satisfies AlbumInfo;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function buildPlaylists(mediaDir: string, tracks: TrackInfo[], playlistFiles: string[]): PlaylistInfo[] {
  const trackByBasename = new Map<string, TrackInfo[]>();
  const sortedTracks = [...tracks].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const track of sortedTracks) {
    const key = path.basename(track.filename).toLowerCase();
    const bucket = trackByBasename.get(key) ?? [];
    bucket.push(track);
    trackByBasename.set(key, bucket);
  }

  return playlistFiles
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const fullPath = path.join(mediaDir, filename);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const entries: PlaylistEntry[] = [];
      let durationSeconds = 0;
      let year = '';

      for (const [index, rawTarget] of parsePlaylist(content).entries()) {
        const normalized = normalizePlaylistTarget(rawTarget);
        const basename = path.basename(normalized).toLowerCase();
        const track = trackByBasename.get(basename)?.[0];
        if (!track) continue;

        durationSeconds += track.durationSeconds;
        if (!year && track.year.trim()) {
          year = track.year;
        }

        entries.push({
          order: index + 1,
          path: normalized,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
        });
      }

      return {
        id: playlistIdFromFilename(filename),
        filename,
        name: path.basename(filename, path.extname(filename)),
        year,
        durationSeconds,
        entries,
      } satisfies PlaylistInfo;
    });
}

/** Parse metadata for a list of media filenames and build TrackInfo entries for them. */
async function buildMediaEntries<
  M extends { parseFile: (filePath: string, opts: { duration: boolean }) => Promise<{ common: unknown; format: { duration?: number } }> },
>(
  mediaDir: string,
  filenames: string[],
  type: 'audio' | 'video',
  descriptionsByStem: Map<string, string[]>,
  funscriptsByStem: Map<string, FunscriptInfo[]>,
  mm: M,
): Promise<TrackInfo[]> {
  type CommonTags = Awaited<ReturnType<M['parseFile']>>['common'] & {
    title?: string;
    artist?: string;
    album?: string;
    year?: number | string;
    track?: number | string | { no?: number | string | null; of?: number | string | null } | null;
    comment?: string | Array<{ text?: string }>;
    picture?: unknown[];
  };
  const entries: TrackInfo[] = [];

  for (const filename of filenames) {
    const filePath = path.join(mediaDir, filename);
    const stem = basenameStem(filename);
    const descriptionFilename = descriptionsByStem.get(stem)?.[0] ?? null;

    let common: CommonTags | null = null;
    let durationSeconds = 0;
    try {
      const meta = await mm.parseFile(filePath, { duration: true });
      common = meta.common as CommonTags;
      durationSeconds = toWholeSeconds(meta.format.duration);
    } catch {
      // Metadata unavailable; fall back to filename-based info below.
    }

    let artworkVersion = 0;
    try {
      artworkVersion = Math.floor(fs.statSync(filePath).mtimeMs);
    } catch {
      // Unreadable stat only costs us cache-busting precision.
    }

    const hasArtwork = Array.isArray(common?.picture) && common.picture.length > 0;

    const firstComment = Array.isArray(common?.comment)
      ? (common.comment[0]?.text ?? '')
      : typeof common?.comment === 'string'
        ? common.comment as string
        : '';

    entries.push({
      id: filenameToId(filename),
      type,
      filename,
      descriptionFilename,
      title: common?.title ?? path.basename(filename, path.extname(filename)),
      artist: common?.artist ?? '',
      album: common?.album ?? '',
      year: common?.year?.toString() ?? '',
      trackNumber: parseTrackNumber(common?.track),
      comment: firstComment,
      hasArtwork,
      artworkVersion,
      durationSeconds,
      funscripts: funscriptsByStem.get(stem) ?? [],
      tags: readDescriptionTags(mediaDir, descriptionFilename),
    });
  }

  return entries;
}

/** Build the full library by scanning the media directory. */
export async function buildLibrary(config: Config.ServerConfig): Promise<LibraryResponse> {
  const MEDIA_DIR = config.mediaDir;

  if (!fs.existsSync(MEDIA_DIR)) {
    console.warn(`[library] Media directory not found: ${MEDIA_DIR}`);
    return { tracks: [], videos: [], albums: [], playlists: [] };
  }

  const allFiles = collectFilesRecursively(MEDIA_DIR);
  const descriptionsByStem = buildDescriptionIndex(allFiles);
  const funscriptPatterns = buildFunscriptPatterns(config);
  const funscriptsByStem = buildFunscriptIndex(allFiles, funscriptPatterns, config.funscriptSuffixSeparator);
  const playlistFiles = allFiles.filter((entry) => path.extname(entry).toLowerCase() === '.m3u');

  // Import music-metadata at runtime (ESM-only package loaded via dynamic import).
  const mm = await import('music-metadata');

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

  const tracks = await buildMediaEntries(MEDIA_DIR, audioFiles, 'audio', descriptionsByStem, funscriptsByStem, mm);
  const videos = await buildMediaEntries(MEDIA_DIR, videoFiles, 'video', descriptionsByStem, funscriptsByStem, mm);

  const allMedia = [...tracks, ...videos];

  return {
    tracks,
    videos,
    albums: buildAlbums(allMedia),
    playlists: buildPlaylists(MEDIA_DIR, allMedia, playlistFiles),
  };
}
