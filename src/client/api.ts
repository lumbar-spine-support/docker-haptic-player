import type { Chapter, ClientSettings, Funscript, FunscriptInfo, LibraryResponse, PlaylistInfo, TrackInfo, VersionInfo } from '../shared/types';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../shared/funscriptNames';
import { parseVrFormat } from '../shared/vrFormat';
import { buildChaptersVtt } from '../shared/webvtt';
import type { JellyfinConnection } from './jellyfin/connection';
import { loadLibrary, setFavorite, type LoadOptions } from './jellyfin/library';
import { toPlaylist } from './jellyfin/mapper';
import { canOverwritePlaylist, createPlaylist, deletePlaylist, loadPlaylist, replacePlaylistItems } from './jellyfin/playlists';
import { imageUrl, streamUrl, trickplayVtt } from './jellyfin/urls';
import { versionFromPluginInfo, type PluginInfo } from './utils/formatVersion';

/** The signed-in Jellyfin session the library, streams and funscripts come from. */
let jellyfin: JellyfinConnection | null = null;
let loadOptions: LoadOptions = { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded', 'funscript'] };

/** Points every media call at a Jellyfin connection; call once the user is signed in. */
export function useJellyfin(connection: JellyfinConnection, options: LoadOptions): void {
  jellyfin = connection;
  loadOptions = options;
}

function requireJellyfin(): JellyfinConnection {
  if (!jellyfin) throw new Error('No Jellyfin connection; call useJellyfin() first.');
  return jellyfin;
}

/** Loads the whole library from Jellyfin into the client's in-memory model. */
export function fetchLibrary(): Promise<LibraryResponse> {
  return loadLibrary(requireJellyfin(), loadOptions);
}

/** Marks or unmarks a track, video or playlist as a Jellyfin favorite; resolves to the stored state. */
export function setJellyfinFavorite(itemId: string, favorite: boolean): Promise<boolean> {
  return setFavorite(requireJellyfin(), itemId, favorite);
}

/** Saves tracks as a new private Jellyfin playlist; resolves to it as the library shows playlists. */
export async function createJellyfinPlaylist(
  name: string, trackIds: readonly string[], tracksById: Map<string, TrackInfo>,
): Promise<PlaylistInfo> {
  const api = requireJellyfin();
  const id = await createPlaylist(api, name, trackIds);
  return toPlaylist(await loadPlaylist(api, id), tracksById);
}

/**
 * Replaces a playlist's entries with `trackIds`. Resolves to `null` without touching it when that
 * would lose entries HAPPY does not show, or the user may not edit it (see `canOverwritePlaylist`).
 */
export async function overwriteJellyfinPlaylist(
  playlist: PlaylistInfo, trackIds: readonly string[], tracksById: Map<string, TrackInfo>,
): Promise<PlaylistInfo | null> {
  const api = requireJellyfin();
  const loaded = playlist.entries.map((entry) => entry.trackId);
  if (!(await canOverwritePlaylist(api, playlist.id, loaded))) return null;
  await replacePlaylistItems(api, playlist.id, trackIds);
  return toPlaylist(await loadPlaylist(api, playlist.id), tracksById);
}

/** Deletes a playlist from Jellyfin (for every app, not just HAPPY). */
export function deleteJellyfinPlaylist(playlistId: string): Promise<void> {
  return deletePlaylist(requireJellyfin(), playlistId);
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
    const vtt = trickplayVtt(requireJellyfin().endpoint, track, parseVrFormat(track.filename));
    storyboardVtts.set(track.id, vtt ? vttBlobUrl(vtt) : null);
  }
  return storyboardVtts.get(track.id) ?? null;
}

/** Fetches a documentation page as raw markdown (served by the plugin, without sign-in). */
export async function fetchDoc(page: string): Promise<string> {
  const res = await fetch(`${requireJellyfin().serverUrl}/Happy/Docs/${encodeURIComponent(page)}`);
  if (!res.ok) {
    throw new Error(`Docs fetch failed: ${res.status}`);
  }
  return res.text();
}

/** Builds the URL of an image referenced from a documentation page. */
export function docAssetUrl(relativePath: string): string {
  return `${requireJellyfin().serverUrl}/Happy/Docs/assets/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

/** Cover image URL of a Jellyfin item; the tag changes whenever the image does, so it caches well. */
export function artworkUrl(trackId: string, artworkTag?: string | null): string {
  return imageUrl(requireJellyfin().serverUrl, trackId, artworkTag);
}

/** Fetches HAPPY's version, which is the version of the Jellyfin plugin serving it. */
export async function fetchVersion(): Promise<VersionInfo> {
  const res = await requireJellyfin().request('/Happy/Info');
  if (!res.ok) {
    throw new Error(`Version fetch failed: ${res.status}`);
  }
  return versionFromPluginInfo(await res.json() as PluginInfo);
}

/** Jellyfin's own web client, next to `/Happy/Web/` (a Jellyfin base URL included). */
export const JELLYFIN_WEB_URL = '../../web/';

/**
 * Signs out of Jellyfin; the reload then shows the sign-in card. A session borrowed from Jellyfin's
 * web client is only left: back to Jellyfin, which stays signed in.
 */
export async function logout(): Promise<void> {
  const borrowed = jellyfin?.borrowed ?? false;
  await jellyfin?.signOut();
  if (borrowed) window.location.assign(JELLYFIN_WEB_URL);
  else window.location.reload();
}

/** Fetches the defaults for client-side settings, configured on the plugin's dashboard page. */
export async function fetchClientSettings(): Promise<ClientSettings> {
  const res = await requireJellyfin().request('/Happy/Config');
  if (!res.ok) {
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
