import fs from 'fs';
import path from 'path';
import type { Chapter, ChapterSource, FunscriptInfo } from '../../shared/types';
import { mergeChapters, normalizeChapters, parseTimestamp, type RawChapter } from '../../shared/chapters';
import { createLogger } from '../utils/logger';

const log = createLogger('[chapters]');

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

/** First source in `priority` that yields chapters; sources are only read until one does. */
export function resolveChapters(
    priority: readonly ChapterSource[],
    sources: Record<ChapterSource, () => RawChapter[]>,
    durationSeconds: number,
): { chapters: Chapter[]; source: ChapterSource } | null {
    for (const source of priority) {
        const chapters = normalizeChapters(sources[source](), durationSeconds);
        if (chapters.length > 0) return { chapters, source };
    }
    return null;
}
