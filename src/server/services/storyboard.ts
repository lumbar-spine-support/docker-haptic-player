/**
 * Storyboards: JPEG sprite sheets of evenly spaced video frames for timeline previews.
 *
 * Generation decodes keyframes only (`-skip_frame nokey`), so a thumbnail can be up to one GOP
 * off its cue time but a long video costs seconds instead of minutes. Videos are processed one
 * at a time in the background; `request()` moves a video to the front of the queue.
 *
 * Layout: `<configDir>/cache/storyboards/<key>/{0.jpg, 1.jpg, …, meta.json}`. The directory is
 * built under `<key>.tmp` and renamed into place, so an existing `meta.json` means complete.
 */

import { execFile, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { TrackInfo } from '../../shared/types';
import { parseVrFormat, type VrFormat } from '../../shared/vrFormat';
import type { StoryboardLayout } from '../../shared/webvtt';
import { Config } from '../config';
import { createLogger } from '../utils/logger';

export const TAG = '[storyboard]';

const log = createLogger(TAG);

export const STORYBOARD_COLUMNS = 10;
export const STORYBOARD_ROWS = 10;
const META_FILE = 'meta.json';
const GENERATE_TIMEOUT_MS = 30 * 60_000;
const KEY_PATTERN = /^[a-f0-9]{40}$/;

/** `sheets === 0` marks a video that could not be decoded, so it is not retried until it changes. */
export type StoryboardMeta = Omit<StoryboardLayout, 'durationSeconds'>;

export interface StoryboardService {
    key(video: TrackInfo): string;
    /** Resolves once the storyboard exists, generating it first (ahead of the background queue). */
    request(video: TrackInfo): Promise<StoryboardMeta | null>;
    /** Prunes storyboards of removed or changed videos and queues the missing ones. */
    sync(videos: readonly TrackInfo[]): void;
    /** Absolute path of a sprite sheet, or null when the key or index does not exist. */
    sheetPath(key: string, index: number): string | null;
    /** Drops the queue and kills a running ffmpeg. */
    stop(): void;
}

function vrCropFilter(vr: VrFormat | null): string | null {
    if (vr?.layout === 'sbs') return 'crop=iw/2:ih:0:0';
    if (vr?.layout === 'tb') return 'crop=iw:ih/2:0:0';
    return null;
}

/** ffmpeg arguments writing `0.jpg`, `1.jpg`, … sprite sheets into `outDir`. */
export function buildStoryboardArgs(filePath: string, vr: VrFormat | null, intervalSeconds: number, width: number, outDir: string): string[] {
    const filters = [vrCropFilter(vr), `fps=1/${intervalSeconds}`, `scale=${width}:-2`, `tile=${STORYBOARD_COLUMNS}x${STORYBOARD_ROWS}`];
    return [
        '-nostdin', '-v', 'error',
        '-skip_frame', 'nokey', '-i', `file:${filePath}`,
        '-map', '0:V:0', '-an', '-sn', '-dn',
        '-vf', filters.filter(Boolean).join(','),
        '-c:v', 'mjpeg', '-q:v', '4',
        '-f', 'image2', '-start_number', '0', path.join(outDir, '%d.jpg'),
    ];
}

interface Deferred {
    promise: Promise<StoryboardMeta | null>;
    resolve: (meta: StoryboardMeta | null) => void;
}

export function createStoryboardService(config: Config.ServerConfig): StoryboardService {
    const dir = Config.storyboardCacheDirPath(config.configDir);
    const interval = Number(config.storyboardInterval);
    const width = Number(config.storyboardWidth);
    const pending: TrackInfo[] = [];
    const waiters = new Map<string, Deferred>();
    let running = false;
    let current: string | null = null;
    let stopped = false;
    let child: ChildProcess | null = null;

    const key = (video: TrackInfo): string => crypto.createHash('sha1')
        .update(`${video.id}:${video.artworkVersion}:${interval}:${width}:${vrCropFilter(parseVrFormat(video.filename)) ?? ''}`)
        .digest('hex');

    const readMeta = (k: string): StoryboardMeta | null => {
        try {
            return JSON.parse(fs.readFileSync(path.join(dir, k, META_FILE), 'utf-8')) as StoryboardMeta;
        } catch {
            return null;
        }
    };

    const exec = (command: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
        child = execFile(command, args, { timeout: GENERATE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            child = null;
            if (err) reject(err);
            else resolve(stdout);
        });
    });

    const generate = async (video: TrackInfo, k: string): Promise<StoryboardMeta | null> => {
        const tmp = path.join(dir, `${k}.tmp`);
        const started = Date.now();
        let meta: StoryboardMeta = { intervalSeconds: interval, columns: STORYBOARD_COLUMNS, rows: STORYBOARD_ROWS, tileWidth: 0, tileHeight: 0, sheets: 0 };
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
            fs.mkdirSync(tmp, { recursive: true });
        } catch (err) {
            log.warn(`Cannot create ${tmp}; storyboards are unavailable:`, err);
            return null;
        }
        try {
            const filePath = path.join(config.mediaDir, video.filename);
            await exec('ffmpeg', buildStoryboardArgs(filePath, parseVrFormat(video.filename), interval, width, tmp));
            const sheets = fs.readdirSync(tmp).filter((name) => /^\d+\.jpg$/.test(name)).length;
            if (sheets > 0) {
                const probe = JSON.parse(await exec('ffprobe', [
                    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', `file:${path.join(tmp, '0.jpg')}`,
                ])) as { streams?: { width?: number; height?: number }[] };
                const sheet = probe.streams?.[0];
                if (sheet?.width && sheet.height) {
                    meta = { ...meta, sheets, tileWidth: Math.floor(sheet.width / STORYBOARD_COLUMNS), tileHeight: Math.floor(sheet.height / STORYBOARD_ROWS) };
                }
            }
            log.debug(`Generated ${meta.sheets} storyboard sheets for ${video.filename} in ${Date.now() - started}ms`);
        } catch (err) {
            if (stopped) return null;
            log.warn(`Storyboard generation failed for ${video.filename}:`, err instanceof Error ? err.message : err);
        }
        try {
            fs.writeFileSync(path.join(tmp, META_FILE), JSON.stringify(meta), 'utf-8');
            fs.rmSync(path.join(dir, k), { recursive: true, force: true });
            fs.renameSync(tmp, path.join(dir, k));
        } catch (err) {
            log.warn(`Failed to cache storyboard ${k}:`, err);
        }
        return meta;
    };

    const waiter = (k: string): Deferred => {
        let deferred = waiters.get(k);
        if (!deferred) {
            let resolve!: Deferred['resolve'];
            const promise = new Promise<StoryboardMeta | null>((r) => { resolve = r; });
            deferred = { promise, resolve };
            waiters.set(k, deferred);
        }
        return deferred;
    };

    const pump = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
            while (pending.length > 0 && !stopped) {
                const video = pending.shift()!;
                const k = key(video);
                current = k;
                const meta = readMeta(k) ?? await generate(video, k);
                current = null;
                waiters.get(k)?.resolve(meta);
                waiters.delete(k);
            }
        } finally {
            running = false;
            current = null;
        }
    };

    const generatable = (video: TrackInfo): boolean => config.storyboardGenerate && video.type === 'video' && video.durationSeconds > 0;

    return {
        key,

        async request(video: TrackInfo): Promise<StoryboardMeta | null> {
            if (!generatable(video) || stopped) return null;
            const k = key(video);
            const cached = readMeta(k);
            if (cached) return cached;
            const deferred = waiter(k);
            if (current !== k) {
                const index = pending.findIndex((item) => key(item) === k);
                if (index >= 0) pending.splice(index, 1);
                pending.unshift(video);
                void pump();
            }
            return deferred.promise;
        },

        sync(videos: readonly TrackInfo[]): void {
            const valid = new Set(videos.filter(generatable).map(key));
            try {
                for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
                    if (valid.has(name) || name === `${current}.tmp`) continue;
                    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
                }
            } catch (err) {
                log.warn(`Failed to prune ${dir}:`, err);
            }
            const queued = new Set([...pending.map(key), current]);
            for (const video of videos) {
                const k = key(video);
                if (valid.has(k) && !queued.has(k) && !readMeta(k)) pending.push(video);
            }
            if (pending.length > 0) log.info(`Queued ${pending.length} videos for storyboard generation`);
            void pump();
        },

        sheetPath(k: string, index: number): string | null {
            if (!KEY_PATTERN.test(k) || !Number.isInteger(index) || index < 0) return null;
            const meta = readMeta(k);
            if (!meta || index >= meta.sheets) return null;
            return path.join(dir, k, `${index}.jpg`);
        },

        stop(): void {
            stopped = true;
            pending.length = 0;
            child?.kill();
            for (const deferred of waiters.values()) deferred.resolve(null);
            waiters.clear();
        },
    };
}
