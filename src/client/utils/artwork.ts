import type { TrackInfo } from '../../shared/types';
import { artworkUrl } from './api';

export const FALLBACK_ART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#333"/></svg>';
export const FALLBACK_ART_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FALLBACK_ART_SVG)}`;

/** Cover URL for a track, or the inline placeholder when there is nothing to fetch. */
export function renderTrackArt(track: TrackInfo | null | undefined): string {
    return track?.hasArtwork ? artworkUrl(track.id, track.artworkVersion) : FALLBACK_ART_DATA_URI;
}

const COLLAGE_SIZE = 400;
const collageCache = new Map<string, Promise<string>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

async function buildCollage(sources: string[]): Promise<string> {
    const images = await Promise.all(sources.map(loadImage));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = COLLAGE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return sources[0];
    const cell = COLLAGE_SIZE / 2;
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, COLLAGE_SIZE, COLLAGE_SIZE);
    images.forEach((img, i) => {
        if (!img) return;
        // Center-crop to a square, like object-fit: cover
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, (i % 2) * cell, Math.floor(i / 2) * cell, cell, cell);
    });
    return canvas.toDataURL('image/jpeg', 0.85);
}

/** Cover for a playlist: 2x2 collage of the first 4 items, or the first item's art when fewer. */
export function playlistCoverArt(tracks: (TrackInfo | null | undefined)[]): Promise<string> {
    const sources = tracks.map(renderTrackArt);
    if (sources.length < 4) return Promise.resolve(sources[0] ?? FALLBACK_ART_DATA_URI);
    const key = sources.slice(0, 4).join('|');
    let cached = collageCache.get(key);
    if (!cached) {
        cached = buildCollage(sources.slice(0, 4));
        collageCache.set(key, cached);
    }
    return cached;
}

/** Sets the first item's art immediately, then swaps in the collage once rendered. */
export function applyPlaylistCover(img: HTMLImageElement | null, tracks: (TrackInfo | null | undefined)[]): void {
    if (!img) return;
    img.src = renderTrackArt(tracks[0]);
    if (tracks.length < 4) return;
    const expected = img.src;
    void playlistCoverArt(tracks).then((src) => {
        if (img.src === expected) img.src = src;
    });
}
