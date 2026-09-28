import type { Chapter } from './types';

/** A chapter as read from a source, before sorting and gap filling. */
export interface RawChapter {
    name: string;
    start: number;
    end?: number;
}

/** Tolerance within which two chapters from different sources are considered the same. */
const MERGE_TOLERANCE_SECONDS = 0.5;

/**
 * Parse a chapter timestamp into seconds.
 * Accepts `HH:MM:SS.mmm`, `MM:SS(.mmm)` and plain milliseconds (number or numeric string).
 */
export function parseTimestamp(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value / 1000 : null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) / 1000;

    const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:[.,]\d+)?)$/.exec(trimmed);
    if (!match) return null;
    const [, hours = '0', minutes, seconds] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds.replace(',', '.'));
}

/** Sort, drop invalid entries, and fill each missing end with the next start (or the duration). */
export function normalizeChapters(raw: RawChapter[], durationSeconds: number): Chapter[] {
    const hasDuration = Number.isFinite(durationSeconds) && durationSeconds > 0;
    const valid = raw
        .filter((c) => Number.isFinite(c.start) && c.start >= 0 && (!hasDuration || c.start < durationSeconds))
        .map((c) => ({ ...c, name: String(c.name ?? '').trim() }))
        .sort((a, b) => a.start - b.start);

    return valid.map((chapter, index) => {
        const nextStart = valid[index + 1]?.start;
        const limit = nextStart ?? (hasDuration ? durationSeconds : Number.POSITIVE_INFINITY);
        const explicit = chapter.end !== undefined && Number.isFinite(chapter.end) && chapter.end > chapter.start
            ? chapter.end
            : limit;
        let end = Math.min(explicit, limit);
        if (!Number.isFinite(end)) end = chapter.start;
        return { name: chapter.name || `Chapter ${index + 1}`, start: chapter.start, end };
    });
}

/** Concatenate chapter lists, dropping entries that repeat a chapter already present. */
export function mergeChapters(lists: RawChapter[][]): RawChapter[] {
    const merged: RawChapter[] = [];
    const all = lists.flat().sort((a, b) => a.start - b.start);
    for (const chapter of all) {
        const duplicate = merged.some((m) =>
            Math.abs(m.start - chapter.start) < MERGE_TOLERANCE_SECONDS
            && m.name.trim().toLowerCase() === chapter.name.trim().toLowerCase());
        if (!duplicate) merged.push(chapter);
    }
    return merged;
}
