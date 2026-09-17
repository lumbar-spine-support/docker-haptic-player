import { artworkUrl } from './api';

export const FALLBACK_ART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#333"/></svg>';
export const FALLBACK_ART_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FALLBACK_ART_SVG)}`;

export function renderTrackArt(trackId: string | null): string {
    return trackId ? artworkUrl(trackId) : FALLBACK_ART_DATA_URI;
}
