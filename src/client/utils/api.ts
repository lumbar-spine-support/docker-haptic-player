import type { LibraryResponse, Funscript, VersionInfo } from '../../shared/types';

const BASE = new URL('.', window.location.href).pathname;

/**
 * Fetches the full track library from the server.
 *
 * @returns The complete library response payload.
 */
export async function fetchLibrary(): Promise<LibraryResponse> {
  const res = await fetch(`${BASE}api/library`);
  if (!res.ok) throw new Error(`Library fetch failed: ${res.status}`);
  return res.json() as Promise<LibraryResponse>;
}

/** Fetches a parsed Funscript payload for the given track/file pair. */
export async function fetchFunscript(trackId: string, filename: string): Promise<Funscript> {
  const res = await fetch(`${BASE}api/funscript/${trackId}/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`Funscript fetch failed: ${res.status}`);
  return res.json() as Promise<Funscript>;
}

/** Builds the media-stream URL for a track or video. */
export function mediaUrl(trackId: string): string {
  return `${BASE}api/media/${trackId}`;
}

/** Fetches the optional markdown description companion file for a track. */
export async function fetchTrackDescription(trackId: string): Promise<string> {
  const res = await fetch(`${BASE}api/media/${trackId}/description`);
  if (!res.ok) throw new Error(`Description fetch failed: ${res.status}`);
  return res.text();
}

/** Builds the artwork URL for a track's embedded cover image. */
export function artworkUrl(trackId: string): string {
  return `${BASE}api/artwork/${trackId}`;
}

/** Fetches the running server/app version info. */
export async function fetchVersion(): Promise<VersionInfo> {
  const res = await fetch(`${BASE}api/version`);
  if (!res.ok) throw new Error(`Version fetch failed: ${res.status}`);
  return res.json() as Promise<VersionInfo>;
}
