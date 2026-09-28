/**
 * Generates an "Auto" funscript from the audio of a media file.
 *
 * ffmpeg decodes the audio to mono float PCM, a short-time FFT measures the magnitude of every bin in
 * the configured frequency band, and each bin is normalised to its own loudest moment in the file.
 * The per-frame mean of those normalised bins becomes the position. Results are cached per media mtime
 * in `<configDir>/cache/autoscript/`; on debug log level a spectrum image is written next to them.
 */

import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Funscript, FunscriptAction, FunscriptType, TrackInfo } from '../../shared/types';
import { FUNSCRIPT_TYPES } from '../../shared/haptics';
import { Config } from '../config';
import { createLogger, isLevelEnabled } from '../utils/logger';

export const TAG = '[autoscript]';

const log = createLogger(TAG);

const JSON_SUFFIX = '.json';
const DEBUG_SUFFIX = '.debug.png';

/** Bins whose loudest moment stays below this are treated as silent, so per-bin scaling cannot amplify noise to 100. */
const NOISE_FLOOR_DBFS = -60;

export interface AutoscriptSettings {
    minFrequency: number;
    maxFrequency: number;
    minPower: number;
    frameMs: number;
    minPositionDelta: number;
}

export interface SpectrumAnalysis {
    sampleRate: number;
    fftSize: number;
    frameMs: number;
    /** Frequency in Hz of each analysed bin. */
    binFrequencies: number[];
    frameCount: number;
    /** Row-major `frameCount x bins` magnitudes. */
    magnitudes: Float32Array;
    /** Loudest magnitude of each bin over the whole file; the per-bin "position 100". */
    binMax: Float32Array;
    /** Per-frame band value in 0..1 after normalisation and thresholding. */
    values: Float32Array;
    actions: FunscriptAction[];
}

export function resolveSettings(config: Config.ServerConfig): AutoscriptSettings {
    const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
    const minFrequency = Math.max(1, finite(config.autoscriptMinFrequency, 20));
    const maxFrequency = Math.max(minFrequency, finite(config.autoscriptMaxFrequency, 200));
    return {
        minFrequency,
        maxFrequency,
        minPower: Math.min(1, Math.max(0, finite(config.autoscriptMinPower, 0.05))),
        frameMs: Math.max(5, Math.round(finite(config.autoscriptFrameMs, 50))),
        minPositionDelta: Math.min(100, Math.max(0, finite(config.autoscriptMinPositionDelta, 2))),
    };
}

/** `generic` is the user-facing name of the `unknown` channel type. */
export function resolveAutoscriptType(value: string): FunscriptType {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'generic') return 'unknown';
    if (FUNSCRIPT_TYPES.includes(normalized as FunscriptType)) return normalized as FunscriptType;
    log.warn(`Unknown ${Config.ENV_NAMES.autoscriptType} "${value}", falling back to "generic".`);
    return 'unknown';
}

/** Nyquist must clear the band's upper edge with some margin for the anti-alias filter. */
export function chooseSampleRate(maxFrequency: number): number {
    return Math.min(48000, Math.max(8000, Math.ceil((maxFrequency * 2.5) / 1000) * 1000));
}

/** Roughly 4 Hz resolution, enough to separate bins in a low-frequency band. */
export function chooseFftSize(sampleRate: number): number {
    return 2 ** Math.ceil(Math.log2(sampleRate / 4));
}

function createFft(size: number): (re: Float64Array, im: Float64Array) => void {
    const levels = Math.log2(size);
    const reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
        let r = 0;
        for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
        reverse[i] = r;
    }
    const cos = new Float64Array(size / 2);
    const sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
        cos[i] = Math.cos((2 * Math.PI * i) / size);
        sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }

    return (re, im) => {
        for (let i = 0; i < size; i++) {
            const j = reverse[i];
            if (j > i) {
                [re[i], re[j]] = [re[j], re[i]];
                [im[i], im[j]] = [im[j], im[i]];
            }
        }
        for (let len = 2; len <= size; len <<= 1) {
            const half = len >> 1;
            const step = size / len;
            for (let start = 0; start < size; start += len) {
                for (let k = 0; k < half; k++) {
                    const a = start + k;
                    const b = a + half;
                    const wr = cos[k * step];
                    const wi = sin[k * step];
                    const tr = re[b] * wr - im[b] * wi;
                    const ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }
    };
}

/** Streaming analyser: feed PCM with `push`, then `finish` to normalise and build the funscript. */
export function createSpectrumAnalyzer(sampleRate: number, settings: AutoscriptSettings) {
    const fftSize = chooseFftSize(sampleRate);
    const hop = Math.max(1, Math.round((sampleRate * settings.frameMs) / 1000));
    const fft = createFft(fftSize);
    const window = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));

    const nyquistBin = fftSize / 2;
    const loBin = Math.min(nyquistBin, Math.max(1, Math.ceil((settings.minFrequency * fftSize) / sampleRate)));
    const hiBin = Math.min(nyquistBin, Math.max(loBin, Math.floor((settings.maxFrequency * fftSize) / sampleRate)));
    const bins = hiBin - loBin + 1;

    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    let pending = new Float32Array(fftSize * 4);
    let pendingLength = 0;
    let skip = 0;
    let magnitudes = new Float32Array(bins * 1024);
    let frameCount = 0;
    const binMax = new Float32Array(bins);

    const analyseFrame = (offset: number): void => {
        for (let i = 0; i < fftSize; i++) {
            re[i] = pending[offset + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);
        if ((frameCount + 1) * bins > magnitudes.length) {
            const grown = new Float32Array(magnitudes.length * 2);
            grown.set(magnitudes);
            magnitudes = grown;
        }
        const row = frameCount * bins;
        for (let b = 0; b < bins; b++) {
            const k = loBin + b;
            const magnitude = Math.hypot(re[k], im[k]);
            magnitudes[row + b] = magnitude;
            if (magnitude > binMax[b]) binMax[b] = magnitude;
        }
        frameCount++;
    };

    return {
        push(samples: Float32Array): void {
            if (skip > 0) {
                const dropped = Math.min(skip, samples.length);
                samples = samples.subarray(dropped);
                skip -= dropped;
            }
            if (pendingLength + samples.length > pending.length) {
                const grown = new Float32Array(Math.max(pending.length * 2, pendingLength + samples.length));
                grown.set(pending.subarray(0, pendingLength));
                pending = grown;
            }
            pending.set(samples, pendingLength);
            pendingLength += samples.length;
            let offset = 0;
            while (pendingLength - offset >= fftSize) {
                analyseFrame(offset);
                offset += hop;
            }
            if (offset > 0) {
                const consumed = Math.min(offset, pendingLength);
                skip = offset - consumed;
                pending.copyWithin(0, consumed, pendingLength);
                pendingLength -= consumed;
            }
        },

        finish(): SpectrumAnalysis {
            // A full-scale sine under a Hann window peaks at fftSize / 4.
            const floor = (fftSize / 4) * 10 ** (NOISE_FLOOR_DBFS / 20);
            const raw = new Float32Array(frameCount);
            let peak = 0;
            for (let f = 0; f < frameCount; f++) {
                let sum = 0;
                let counted = 0;
                for (let b = 0; b < bins; b++) {
                    if (binMax[b] <= floor) continue;
                    sum += magnitudes[f * bins + b] / binMax[b];
                    counted++;
                }
                raw[f] = counted > 0 ? sum / counted : 0;
                if (raw[f] > peak) peak = raw[f];
            }

            // Bins rarely peak together, so the band mean is rescaled once more to let the loudest moment reach 100.
            const values = new Float32Array(frameCount);
            for (let f = 0; f < frameCount; f++) {
                const v = peak > 0 ? raw[f] / peak : 0;
                values[f] = v < settings.minPower ? 0 : v;
            }

            const centerMs = (fftSize / 2 / sampleRate) * 1000;
            const actions: FunscriptAction[] = [];
            let last = -Infinity;
            const positions = Array.from(values, (v) => Math.round(v * 100));
            for (let f = 0; f < frameCount; f++) {
                const pos = positions[f];
                const isLast = f === frameCount - 1;
                // Turning points are kept regardless of the delta so peaks are not flattened.
                const prev = positions[f - 1] ?? pos;
                const next = positions[f + 1] ?? pos;
                const isExtremum = (pos > prev && pos >= next) || (pos < prev && pos <= next);
                if (actions.length === 0 || Math.abs(pos - last) >= settings.minPositionDelta || ((isLast || isExtremum) && pos !== last)) {
                    actions.push({ at: Math.round(f * settings.frameMs + centerMs), pos });
                    last = pos;
                }
            }

            const binFrequencies = Array.from({ length: bins }, (_, b) => ((loBin + b) * sampleRate) / fftSize);
            return {
                sampleRate,
                fftSize,
                frameMs: settings.frameMs,
                binFrequencies,
                frameCount,
                magnitudes: magnitudes.subarray(0, frameCount * bins),
                binMax,
                values,
                actions,
            };
        },
    };
}

export function analyzeSamples(samples: Float32Array, sampleRate: number, settings: AutoscriptSettings): SpectrumAnalysis {
    const analyzer = createSpectrumAnalyzer(sampleRate, settings);
    analyzer.push(samples);
    return analyzer.finish();
}

let ffmpegAvailable: boolean | null = null;

export function isFfmpegAvailable(): boolean {
    if (ffmpegAvailable === null) {
        const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        ffmpegAvailable = result.status === 0;
        if (!ffmpegAvailable) log.warn('ffmpeg not found; the Auto funscript is disabled.');
    }
    return ffmpegAvailable;
}

export function isAutoscriptAvailable(config: Config.ServerConfig): boolean {
    return Boolean(config.autoscriptEnabled) && isFfmpegAvailable();
}

function decodeAndAnalyze(filePath: string, settings: AutoscriptSettings): Promise<SpectrumAnalysis> {
    const sampleRate = chooseSampleRate(settings.maxFrequency);
    const analyzer = createSpectrumAnalyzer(sampleRate, settings);
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', [
            '-v', 'error', '-nostdin', '-i', filePath, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let remainder = Buffer.alloc(0);
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            const data = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
            const usable = data.length - (data.length % 4);
            // Copy so the Float32Array view is 4-byte aligned regardless of the Buffer pool offset.
            const aligned = new Float32Array(usable / 4);
            Buffer.from(aligned.buffer).set(data.subarray(0, usable));
            analyzer.push(aligned);
            remainder = Buffer.from(data.subarray(usable));
        });
        child.stderr.on('data', (chunk: Buffer) => {
            if (stderr.length < 4096) stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
                return;
            }
            resolve(analyzer.finish());
        });
    });
}

function heatColor(v: number): [number, number, number] {
    const t = Math.min(1, Math.max(0, v));
    if (t < 0.5) return [0, Math.round(t * 2 * 128), Math.round(64 + t * 2 * 191)];
    const u = (t - 0.5) * 2;
    return [Math.round(u * 255), Math.round(128 + u * 127), Math.round(255 * (1 - u))];
}

/** RGB24 image: band spectrogram with per-bin max panel on top, position curve and threshold below. */
export function renderDebugImage(analysis: SpectrumAnalysis, settings: AutoscriptSettings): { width: number; height: number; pixels: Buffer } {
    const bins = analysis.binFrequencies.length;
    const plotWidth = Math.max(1, Math.min(1600, analysis.frameCount));
    const panelWidth = 80;
    const width = plotWidth + panelWidth;
    const specHeight = 200;
    const gap = 4;
    const curveHeight = 150;
    const height = specHeight + gap + curveHeight;
    const pixels = Buffer.alloc(width * height * 3, 16);
    const put = (x: number, y: number, [r, g, b]: [number, number, number]) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const i = (y * width + x) * 3;
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
    };

    const frameRange = (x: number): [number, number] => {
        const start = Math.floor((x * analysis.frameCount) / plotWidth);
        return [start, Math.max(start + 1, Math.floor(((x + 1) * analysis.frameCount) / plotWidth))];
    };

    for (let x = 0; x < plotWidth; x++) {
        const [from, to] = frameRange(x);
        for (let y = 0; y < specHeight; y++) {
            const b = Math.min(bins - 1, Math.floor(((specHeight - 1 - y) * bins) / specHeight));
            const max = analysis.binMax[b];
            let v = 0;
            for (let f = from; f < to && f < analysis.frameCount; f++) {
                v = Math.max(v, max > 0 ? analysis.magnitudes[f * bins + b] / max : 0);
            }
            put(x, y, heatColor(v));
        }
    }

    let globalMax = 0;
    for (const m of analysis.binMax) globalMax = Math.max(globalMax, m);
    for (let y = 0; y < specHeight; y++) {
        const b = Math.min(bins - 1, Math.floor(((specHeight - 1 - y) * bins) / specHeight));
        const len = globalMax > 0 ? Math.round((analysis.binMax[b] / globalMax) * (panelWidth - 4)) : 0;
        for (let x = 0; x < len; x++) put(plotWidth + 2 + x, y, [230, 160, 40]);
    }

    const top = specHeight + gap;
    const yFor = (v: number) => top + Math.round((1 - v) * (curveHeight - 1));
    const thresholdY = yFor(settings.minPower);
    for (let x = 0; x < width; x++) put(x, thresholdY, [200, 40, 40]);
    let prevY: number | null = null;
    for (let x = 0; x < plotWidth; x++) {
        const [from, to] = frameRange(x);
        let v = 0;
        for (let f = from; f < to && f < analysis.frameCount; f++) v = Math.max(v, analysis.values[f]);
        const y = yFor(v);
        const [y0, y1] = prevY === null ? [y, y] : [Math.min(prevY, y), Math.max(prevY, y)];
        for (let yy = y0; yy <= y1; yy++) put(x, yy, [240, 240, 240]);
        prevY = y;
    }

    return { width, height, pixels };
}

function writePng(outPath: string, image: { width: number; height: number; pixels: Buffer }): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', [
            '-v', 'error', '-nostdin', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${image.width}x${image.height}`,
            '-i', 'pipe:0', '-frames:v', '1', outPath,
        ], { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`))));
        child.stdin.on('error', () => { /* surfaced through close */ });
        child.stdin.end(image.pixels);
    });
}

export interface AutoFunscriptService {
    key(trackId: string, mediaVersion: number): string;
    get(track: TrackInfo): Promise<Funscript>;
    /** Drops cached scripts and debug images whose key is not referenced by the current library. */
    prune(validKeys: Set<string>): void;
}

export function createAutoFunscriptService(config: Config.ServerConfig): AutoFunscriptService {
    const dir = Config.autoscriptCacheDirPath(config.configDir);
    const settings = resolveSettings(config);
    const settingsHash = JSON.stringify(settings);
    const inflight = new Map<string, Promise<Funscript>>();
    // One decode at a time; a long video already saturates a core.
    let queue: Promise<unknown> = Promise.resolve();

    const key = (trackId: string, mediaVersion: number): string =>
        crypto.createHash('sha1').update(`${trackId}:${mediaVersion}:${settingsHash}`).digest('hex');

    const readCached = (k: string): Funscript | null => {
        try {
            return JSON.parse(fs.readFileSync(path.join(dir, `${k}${JSON_SUFFIX}`), 'utf-8')) as Funscript;
        } catch {
            return null;
        }
    };

    const generate = async (track: TrackInfo, k: string): Promise<Funscript> => {
        const filePath = path.join(config.mediaDir, track.filename);
        const started = Date.now();
        const analysis = await decodeAndAnalyze(filePath, settings);
        const funscript: Funscript = { version: '1.0', actions: analysis.actions };
        log.debug(`Generated Auto funscript for ${track.filename} (${analysis.actions.length} actions) in ${Date.now() - started}ms`);

        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${k}${JSON_SUFFIX}`), JSON.stringify(funscript), 'utf-8');
        } catch (err) {
            log.warn(`Could not cache Auto funscript for ${track.filename}:`, err);
        }

        if (isLevelEnabled('debug') && analysis.frameCount > 0) {
            const outPath = path.join(dir, `${k}${DEBUG_SUFFIX}`);
            try {
                await writePng(outPath, renderDebugImage(analysis, settings));
                log.debug(`Wrote spectrum debug image ${outPath}`);
            } catch (err) {
                log.warn(`Could not write spectrum debug image for ${track.filename}:`, err);
            }
        }
        return funscript;
    };

    return {
        key,

        get(track: TrackInfo): Promise<Funscript> {
            const k = key(track.id, track.artworkVersion);
            const cached = readCached(k);
            if (cached) return Promise.resolve(cached);
            const running = inflight.get(k);
            if (running) return running;
            const pending = queue.then(() => generate(track, k)).finally(() => inflight.delete(k));
            queue = pending.catch(() => undefined);
            inflight.set(k, pending);
            return pending;
        },

        prune(validKeys: Set<string>): void {
            if (!fs.existsSync(dir)) return;
            let removed = 0;
            try {
                for (const name of fs.readdirSync(dir)) {
                    const suffix = name.endsWith(DEBUG_SUFFIX) ? DEBUG_SUFFIX : name.endsWith(JSON_SUFFIX) ? JSON_SUFFIX : null;
                    if (!suffix || validKeys.has(name.slice(0, -suffix.length))) continue;
                    fs.rmSync(path.join(dir, name), { force: true });
                    removed++;
                }
            } catch (err) {
                log.warn(`Failed to prune ${dir}:`, err);
                return;
            }
            if (removed > 0) log.debug(`Pruned ${removed} stale Auto funscript cache files`);
        },
    };
}
