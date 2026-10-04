export type ArtAspect = 'landscape' | 'square' | 'portrait';

const LANDSCAPE_MIN_RATIO = 1.2;

export function classifyArtAspect(width: number, height: number): ArtAspect {
    if (width <= 0 || height <= 0) return 'square';
    const ratio = width / height;
    if (ratio >= LANDSCAPE_MIN_RATIO) return 'landscape';
    if (ratio <= 1 / LANDSCAPE_MIN_RATIO) return 'portrait';
    return 'square';
}
