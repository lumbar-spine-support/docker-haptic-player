import type { LibraryResponse, Funscript, VersionInfo, ClientSettings, TrackInfo } from '../shared/types';

const BASE = new URL('.', window.location.href).pathname;

let redirectingToLogin = false;

/** Reports an expired or missing access token and sends the user back to the login page. */
function handleUnauthorized(res: Response, what: string): void {
  if (res.status !== 401) return;

  console.error(`[auth] ${what} rejected: token missing or invalid (401). Redirecting to login.`);
  if (redirectingToLogin) return;

  redirectingToLogin = true;
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`${BASE}auth/?returnTo=${returnTo}`);
}

/**
 * Fetches the full track library from the server.
 *
 * @returns The complete library response payload.
 */
export async function fetchLibrary(): Promise<LibraryResponse> {
  const res = await fetch(`${BASE}api/library`);
  if (!res.ok) {
    handleUnauthorized(res, 'Library fetch');
    throw new Error(`Library fetch failed: ${res.status}`);
  }
  return res.json() as Promise<LibraryResponse>;
}

/** Fetches a parsed Funscript payload for the given track/file pair. */
export async function fetchFunscript(trackId: string, filename: string): Promise<Funscript> {
  const res = await fetch(`${BASE}api/funscript/${trackId}/${encodeURIComponent(filename)}`);
  if (!res.ok) {
    handleUnauthorized(res, 'Funscript fetch');
    throw new Error(`Funscript fetch failed: ${res.status}`);
  }
  return res.json() as Promise<Funscript>;
}

/** Builds the media-stream URL for a track or video. */
export function mediaUrl(trackId: string): string {
  return `${BASE}api/media/${trackId}`;
}

export function chaptersVttUrl(track: TrackInfo): string | null {
  return track.chapters?.length ? `${BASE}api/media/${track.id}/chapters.vtt` : null;
}

export function storyboardVttUrl(_track: TrackInfo): string | null {
  return null;
}

/** Fetches the optional markdown description companion file for a track. */
export async function fetchTrackDescription(trackId: string): Promise<string> {
  const res = await fetch(`${BASE}api/media/${trackId}/description`);
  if (!res.ok) {
    handleUnauthorized(res, 'Description fetch');
    throw new Error(`Description fetch failed: ${res.status}`);
  }
  return res.text();
}

/** Fetches a documentation page as raw markdown. */
export async function fetchDoc(page: string): Promise<string> {
  const res = await fetch(`${BASE}api/docs/${encodeURIComponent(page)}`);
  if (!res.ok) {
    handleUnauthorized(res, 'Docs fetch');
    throw new Error(`Docs fetch failed: ${res.status}`);
  }
  return res.text();
}

/** Builds the URL of an image referenced from a documentation page. */
export function docAssetUrl(relativePath: string): string {
  return `${BASE}api/docs/assets/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Builds the artwork URL for a track's embedded cover image.
 *
 * Passing the track's `artworkVersion` lets the server mark the response `immutable`, so repeat
 * visits skip the request entirely instead of revalidating.
 */
export function artworkUrl(trackId: string, artworkVersion?: number): string {
  const base = `${BASE}api/artwork/${trackId}`;
  return artworkVersion ? `${base}?v=${artworkVersion}` : base;
}

/** Fetches the running server/app version info. */
export async function fetchVersion(): Promise<VersionInfo> {
  const res = await fetch(`${BASE}api/version`);
  if (!res.ok) {
    handleUnauthorized(res, 'Version fetch');
    throw new Error(`Version fetch failed: ${res.status}`);
  }
  return res.json() as Promise<VersionInfo>;
}

/** Reports whether authentication is enabled and whether the current token is still valid. */
export async function fetchAuthStatus(): Promise<{ required: boolean; authenticated: boolean }> {
  const res = await fetch(`${BASE}api/auth/status`);
  if (!res.ok) throw new Error(`Auth status fetch failed: ${res.status}`);
  return res.json() as Promise<{ required: boolean; authenticated: boolean }>;
}

/** Revokes the current access token and returns to the login page. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}api/auth/logout`, { method: 'POST' });
  } catch (err) {
    console.error('[auth] Logout request failed', err);
  }
  window.location.replace(`${BASE}auth/`);
}

/** Fetches the server-configured defaults for client-side settings. */
export async function fetchClientSettings(): Promise<ClientSettings> {
  const res = await fetch(`${BASE}api/config`);
  if (!res.ok) {
    handleUnauthorized(res, 'Config fetch');
    throw new Error(`Config fetch failed: ${res.status}`);
  }
  return res.json() as Promise<ClientSettings>;
}


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
