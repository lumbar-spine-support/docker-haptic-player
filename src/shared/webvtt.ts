import type { Chapter } from './types';

/** `HH:MM:SS.mmm`; hours may exceed 24. */
export function formatVttTimestamp(seconds: number): string {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const ms = totalMs % 1000;
    const totalS = Math.floor(totalMs / 1000);
    const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
    return `${pad(Math.floor(totalS / 3600))}:${pad(Math.floor(totalS / 60) % 60)}:${pad(totalS % 60)}.${pad(ms, 3)}`;
}

/** One-line cue payload; `-->` would read as a cue timing separator (WebVTT, not HTML, so `--!>` is harmless). */
const cueText = (text: string): string => text.replace(/\s+/g, ' ').split('-->').join('->').trim();

const vttFile = (cues: string[]): string => `WEBVTT\n\n${cues.join('\n\n')}\n`;

export function buildChaptersVtt(chapters: readonly Chapter[]): string {
    return vttFile(chapters.map((c) => `${formatVttTimestamp(c.start)} --> ${formatVttTimestamp(c.end)}\n${cueText(c.name)}`));
}

export interface StoryboardLayout {
    durationSeconds: number;
    intervalSeconds: number;
    columns: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
    /** Number of sprite sheets that exist; cues beyond them are dropped. */
    sheets: number;
    /** Number of thumbnails that exist when the last sheet is only partly filled; cues beyond it are dropped. */
    count?: number;
    /** Part of each tile shown, from its top-left corner (e.g. one eye of a VR180 frame); defaults to the whole tile. */
    cropWidth?: number;
    cropHeight?: number;
}

/** One cue per interval, each pointing at its tile via a `#xywh=` media fragment. */
export function buildStoryboardVtt(layout: StoryboardLayout, sheetUrl: (index: number) => string): string {
    const { durationSeconds, intervalSeconds, columns, rows, tileWidth, tileHeight, sheets } = layout;
    const perSheet = columns * rows;
    const count = Math.min(Math.ceil(durationSeconds / intervalSeconds), sheets * perSheet, layout.count ?? Infinity);
    const width = layout.cropWidth ?? tileWidth;
    const height = layout.cropHeight ?? tileHeight;
    const cues: string[] = [];
    for (let i = 0; i < count; i++) {
        const start = i * intervalSeconds;
        const end = Math.min(start + intervalSeconds, durationSeconds);
        const tile = i % perSheet;
        const x = (tile % columns) * tileWidth;
        const y = Math.floor(tile / columns) * tileHeight;
        cues.push(`${formatVttTimestamp(start)} --> ${formatVttTimestamp(end)}\n${sheetUrl(Math.floor(i / perSheet))}#xywh=${x},${y},${width},${height}`);
    }
    return vttFile(cues);
}
