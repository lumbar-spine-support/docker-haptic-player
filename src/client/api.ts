import type { Chapter, ClientSettings, Funscript, FunscriptInfo, LibraryResponse, TrackInfo, VersionInfo } from '../shared/types';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../shared/funscriptNames';
import { buildChaptersVtt } from '../shared/webvtt';
import type { JellyfinConnection } from './jellyfin/connection';
import { loadLibrary } from './jellyfin/library';
import type { MapOptions } from './jellyfin/mapper';
import { imageUrl, streamUrl, trickplayVtt } from './jellyfin/urls';

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

/** The signed-in Jellyfin session the library, streams and funscripts come from. */
let jellyfin: JellyfinConnection | null = null;
let mapOptions: MapOptions = { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded', 'funscript'] };

/** Points every media call at a Jellyfin connection; call once the user is signed in. */
export function useJellyfin(connection: JellyfinConnection, options: MapOptions): void {
  jellyfin = connection;
  mapOptions = options;
}

function requireJellyfin(): JellyfinConnection {
  if (!jellyfin) throw new Error('No Jellyfin connection; call useJellyfin() first.');
  return jellyfin;
}

/** Loads the whole library from Jellyfin into the client's in-memory model. */
export function fetchLibrary(): Promise<LibraryResponse> {
  return loadLibrary(requireJellyfin(), mapOptions);
}

/** Fetches one funscript through the HAPPY Jellyfin plugin. The raw JSON also carries chapter metadata. */
export async function fetchFunscript(track: TrackInfo, funscript: FunscriptInfo): Promise<Funscript & { metadata?: unknown }> {
  const res = await requireJellyfin().request(
    `/Happy/Items/${encodeURIComponent(track.id)}/Funscripts/${encodeURIComponent(funscript.key)}`);
  if (!res.ok) throw new Error(`Funscript fetch failed: ${res.status}`);
  return res.json() as Promise<Funscript & { metadata?: unknown }>;
}

/** Builds the media-stream URL for a track or video. */
export function mediaUrl(track: Pick<TrackInfo, 'id' | 'type'>): string {
  return streamUrl(requireJellyfin().endpoint, track);
}

// Generated WebVTT lives in blob: URLs, which are same-origin and so need no CORS for <track>.
const chapterVtts = new WeakMap<Chapter[], string>();
const storyboardVtts = new Map<string, string | null>();

function vttBlobUrl(vtt: string): string {
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}

export function chaptersVttUrl(track: TrackInfo): string | null {
  const chapters = track.chapters;
  if (!chapters?.length) return null;
  let url = chapterVtts.get(chapters);
  if (!url) {
    url = vttBlobUrl(buildChaptersVtt(chapters));
    chapterVtts.set(chapters, url);
  }
  return url;
}

export function storyboardVttUrl(track: TrackInfo): string | null {
  if (track.type !== 'video' || !track.trickplay) return null;
  if (!storyboardVtts.has(track.id)) {
    const vtt = trickplayVtt(requireJellyfin().endpoint, track);
    storyboardVtts.set(track.id, vtt ? vttBlobUrl(vtt) : null);
  }
  return storyboardVtts.get(track.id) ?? null;
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

/** Cover image URL of a Jellyfin item; the tag changes whenever the image does, so it caches well. */
export function artworkUrl(trackId: string, artworkTag?: string | null): string {
  return imageUrl(requireJellyfin().serverUrl, trackId, artworkTag);
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

/** Signs out of Jellyfin and, when HAPPY's own password is enabled, revokes that token too. */
export async function logout(): Promise<void> {
  await jellyfin?.signOut();
  let happyAuth = false;
  try {
    happyAuth = (await fetchAuthStatus()).required;
  } catch {
    // Unknown: fall through to a reload, which shows whichever sign-in is still missing.
  }
  if (!happyAuth) {
    window.location.reload();
    return;
  }
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
    return track?.hasArtwork ? artworkUrl(track.id, track.artworkTag) : FALLBACK_ART_DATA_URI;
}

const COLLAGE_SIZE = 400;
const collageCache = new Map<string, Promise<string>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        // Jellyfin is another origin; without CORS mode the canvas would be tainted and toDataURL would throw.
        img.crossOrigin = 'anonymous';
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
