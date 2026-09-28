import { execFile } from 'child_process';
import type { RawChapter } from '../../shared/chapters';

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_BUFFER = 16 * 1024 * 1024;
const ARTWORK_MAX_BYTES = 20 * 1024 * 1024;

export interface MediaTags {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    track?: string;
    comment?: string;
}

export interface MediaProbe {
    durationSeconds: number;
    tags: MediaTags;
    hasArtwork: boolean;
    chapters: RawChapter[];
}

export type ProbeFn = (filePath: string) => Promise<MediaProbe>;

interface FfprobeStream {
    codec_type?: string;
    disposition?: { attached_pic?: number };
    tags?: Record<string, string>;
}

interface FfprobeChapter {
    start_time?: string;
    end_time?: string;
    tags?: Record<string, string>;
}

export interface FfprobeOutput {
    format?: { duration?: string; tags?: Record<string, string> };
    streams?: FfprobeStream[];
    chapters?: FfprobeChapter[];
}

function run(command: string, args: string[], maxBuffer: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { encoding: 'buffer', timeout: PROBE_TIMEOUT_MS, maxBuffer }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

function lowerKeys(tags: Record<string, string> | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags ?? {})) result[key.toLowerCase()] = value;
    return result;
}

function toNumber(value: string | undefined): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}

/** Map raw ffprobe JSON to the fields the library needs. */
export function mapFfprobeOutput(output: FfprobeOutput): MediaProbe {
    const streams = output.streams ?? [];
    // Ogg/FLAC/Opus keep their tags on the audio stream rather than the container.
    const audioTags = lowerKeys(streams.find((s) => s.codec_type === 'audio')?.tags);
    const tags = { ...audioTags, ...lowerKeys(output.format?.tags) };
    const pick = (...keys: string[]): string | undefined => {
        for (const key of keys) {
            const value = tags[key]?.trim();
            if (value) return value;
        }
        return undefined;
    };

    const duration = toNumber(output.format?.duration);
    const chapters = (output.chapters ?? []).map((c): RawChapter => ({
        name: lowerKeys(c.tags).title ?? '',
        start: toNumber(c.start_time),
        end: toNumber(c.end_time),
    }));

    return {
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
        tags: {
            title: pick('title'),
            artist: pick('artist', 'album_artist'),
            album: pick('album'),
            year: pick('date', 'year', 'originaldate')?.match(/\d{4}/)?.[0],
            track: pick('track', 'tracknumber'),
            comment: pick('comment', 'description'),
        },
        hasArtwork: streams.some((s) => s.disposition?.attached_pic === 1),
        chapters,
    };
}

export const probeMedia: ProbeFn = async (filePath) => {
    // The `file:` prefix stops ffmpeg from reading a protocol out of the file name.
    const stdout = await run('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format', '-show_streams', '-show_chapters',
        `file:${filePath}`,
    ], PROBE_MAX_BUFFER);
    return mapFfprobeOutput(JSON.parse(stdout.toString('utf-8')) as FfprobeOutput);
};

/** Raw bytes of the embedded cover, or null when the file has none. */
export async function extractArtwork(filePath: string): Promise<Buffer | null> {
    try {
        // `-map 0:v -map -0:V` keeps only attached pictures, never real video frames.
        const data = await run('ffmpeg', [
            '-nostdin', '-v', 'error', '-i', `file:${filePath}`,
            '-map', '0:v', '-map', '-0:V', '-frames:v', '1',
            '-c', 'copy', '-f', 'image2pipe', '-',
        ], ARTWORK_MAX_BYTES);
        return data.length > 0 ? data : null;
    } catch {
        return null;
    }
}

/** Whether the ffprobe binary can be executed. */
export async function isFfprobeAvailable(): Promise<boolean> {
    try {
        await run('ffprobe', ['-version'], 1024 * 1024);
        return true;
    } catch {
        return false;
    }
}
