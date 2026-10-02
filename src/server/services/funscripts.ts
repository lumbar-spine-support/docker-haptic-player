import fs from 'fs';
import path from 'path';
import type { FunscriptInfo, FunscriptType } from '../../shared/types';
import { mergeChapters, parseTimestamp, type RawChapter } from '../../shared/chapters';
import { Config } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('[chapters]');

export const FUNSCRIPT_EXT = '.funscript';

export type FunscriptPattern = { type: FunscriptType; suffix: string };

// Funscript type → suffix mapping used for discovery.
export function buildFunscriptPatterns(config: Config.ServerConfig): FunscriptPattern[] {
  return [
    { type: 'stroker', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixStroker}.funscript` },
    { type: 'buttplug', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixButtplug}.funscript` },
    { type: 'vibrator', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixVibrator}.funscript` },
    { type: 'estim', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixEstim}.funscript` },
    { type: 'machine', suffix: `${config.funscriptSuffixSeparator}${config.funscriptSuffixMachine}.funscript` },
  ];
}

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
  patterns: FunscriptPattern[],
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

/** Funscripts grouped by the lowercased stem of the media file they belong to. */
export function buildFunscriptIndex(
  allFiles: string[],
  patterns: FunscriptPattern[],
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

/** Chapters from `metadata.chapters` of a funscript, in the MultiFunPlayer/OFS format. */
export function parseFunscriptChapters(json: unknown): RawChapter[] {
  const chapters = (json as { metadata?: { chapters?: unknown } } | null)?.metadata?.chapters;
  if (!Array.isArray(chapters)) return [];

  const result: RawChapter[] = [];
  for (const entry of chapters) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, startTime, endTime } = entry as { name?: unknown; startTime?: unknown; endTime?: unknown };
    const start = parseTimestamp(startTime);
    if (start === null) continue;
    result.push({
      name: typeof name === 'string' ? name : '',
      start,
      end: parseTimestamp(endTime) ?? undefined,
    });
  }
  return result;
}

/** Read chapters from every funscript of a track, merging them when more than one provides any. */
export function readFunscriptChapters(mediaDir: string, mediaFilename: string, funscripts: FunscriptInfo[]): RawChapter[] {
  const found: Array<{ filename: string; chapters: RawChapter[] }> = [];
  for (const funscript of funscripts) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(mediaDir, funscript.filename), 'utf-8'));
      const chapters = parseFunscriptChapters(json);
      if (chapters.length > 0) found.push({ filename: funscript.filename, chapters });
    } catch {
      // Unreadable funscripts are reported when they are played, not while indexing.
    }
  }

  if (found.length > 1) {
    log.warn(
      `${mediaFilename}: ${found.length} funscripts define chapters (${found.map((f) => f.filename).join(', ')}); merging them`,
    );
  }
  return mergeChapters(found.map((f) => f.chapters));
}
