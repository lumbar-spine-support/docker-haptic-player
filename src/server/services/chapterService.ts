import type { Chapter, ChapterSource } from '../../shared/types';
import { normalizeChapters, type RawChapter } from '../../shared/chapters';

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
