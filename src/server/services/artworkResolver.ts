import path from 'path';
import { Config } from '../config';
import type { ArtworkCache, ArtworkCacheEntry } from './artworkCache';
import { extractArtwork, extractVideoFrame, probeMedia } from './mediaProbe';

export interface ArtworkResolver {
    /** Cached cover for a media file: embedded art first, then a generated frame for videos. */
    resolve(trackId: string, filePath: string, artworkVersion: number, durationSeconds?: number): Promise<ArtworkCacheEntry>;
}

export function detectMimeFromBytes(data: Uint8Array): string | null {
    if (data.length < 4) return null;
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif';
    if (
        data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data.length >= 12 &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
    ) return 'image/webp';
    if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp';
    return null;
}

function isVideoFile(filePath: string): boolean {
    return Config.VIDEO_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase());
}

export function createArtworkResolver(config: Config.ServerConfig, cache: ArtworkCache): ArtworkResolver {
    const inflight = new Map<string, Promise<ArtworkCacheEntry>>();

    const generate = async (filePath: string, durationSeconds?: number): Promise<Buffer | null> => {
        let duration = durationSeconds;
        if (!duration) {
            try {
                duration = (await probeMedia(filePath)).durationSeconds;
            } catch {
                duration = 0;
            }
        }
        return extractVideoFrame(filePath, duration * (Number(config.videoArtworkOffset) / 100));
    };

    const load = async (key: string, filePath: string, durationSeconds?: number): Promise<ArtworkCacheEntry> => {
        let data = await extractArtwork(filePath);
        if (!data && config.videoArtworkGenerate && isVideoFile(filePath)) data = await generate(filePath, durationSeconds);
        // Remember the absence too, so art-less files never trigger another full parse.
        const entry: ArtworkCacheEntry = data
            ? { mime: detectMimeFromBytes(data) ?? 'image/jpeg', data }
            : { mime: null, data: null };
        cache.write(key, entry.mime, entry.data);
        return entry;
    };

    return {
        resolve(trackId, filePath, artworkVersion, durationSeconds) {
            const key = cache.key(trackId, artworkVersion);
            const cached = cache.read(key);
            if (cached) return Promise.resolve(cached);
            let pending = inflight.get(key);
            if (!pending) {
                pending = load(key, filePath, durationSeconds).finally(() => inflight.delete(key));
                inflight.set(key, pending);
            }
            return pending;
        },
    };
}
