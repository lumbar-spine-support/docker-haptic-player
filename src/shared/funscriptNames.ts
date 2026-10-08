import type { FunscriptType } from './types';
import { parseTimestamp, type RawChapter } from './chapters';

export const FUNSCRIPT_EXT = '.funscript';

/** Typed funscript suffixes, as in `<stem><separator><suffix>.funscript`. Mirrors the FUNSCRIPT_SUFFIX_* settings. */
export interface FunscriptSuffixes {
  separator: string;
  stroker: string;
  buttplug: string;
  vibrator: string;
  estim: string;
  machine: string;
}

export const DEFAULT_FUNSCRIPT_SUFFIXES: FunscriptSuffixes = {
  separator: '.',
  stroker: 'stroker',
  buttplug: 'buttplug',
  vibrator: 'vibrator',
  estim: 'estim',
  machine: 'machine',
};

const TYPED: readonly Exclude<FunscriptType, 'unknown'>[] = ['stroker', 'buttplug', 'vibrator', 'estim', 'machine'];

/**
 * Split a funscript file name into media stem, type and optional subcategory.
 *
 * Accepts `<stem><sep><type>.funscript` and `<stem><sep><type><sep><sub>.funscript`,
 * so the same type can appear several times per track (e.g. estim for nipples and butt).
 * Names without a recognised type suffix fall back to the `unknown` ("Generic") type,
 * with the whole basename treated as the media stem. Any directory part is ignored.
 */
export function parseFunscriptName(
  filename: string,
  suffixes: FunscriptSuffixes = DEFAULT_FUNSCRIPT_SUFFIXES,
): { stem: string; type: FunscriptType; sub?: string } | null {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const lower = base.toLowerCase();
  if (!lower.endsWith(FUNSCRIPT_EXT)) return null;

  const { separator } = suffixes;
  const body = lower.slice(0, lower.length - FUNSCRIPT_EXT.length);
  const untyped = { stem: body, type: 'unknown' as FunscriptType };
  const typeBySuffix = new Map(TYPED.map((type) => [suffixes[type].toLowerCase(), type]));

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
