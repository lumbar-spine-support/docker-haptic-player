import type { LibraryResponse, Funscript, VersionInfo } from '../../shared/types';

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

/** Fetches the optional markdown description companion file for a track. */
export async function fetchTrackDescription(trackId: string): Promise<string> {
  const res = await fetch(`${BASE}api/media/${trackId}/description`);
  if (!res.ok) {
    handleUnauthorized(res, 'Description fetch');
    throw new Error(`Description fetch failed: ${res.status}`);
  }
  return res.text();
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

/** Client-visible half of the server configuration. */
export interface ClientConfig {
  videoSeekInterval: number;
  dglabEnabled: boolean;
  /** LAN addresses of the server, for suggesting a reachable pairing address. */
  serverHosts?: string[];
}

/** Fetches the client-facing configuration; server-only settings are never exposed. */
export async function fetchClientConfig(): Promise<ClientConfig> {
  const res = await fetch(`${BASE}api/config`);
  if (!res.ok) {
    handleUnauthorized(res, 'Config fetch');
    throw new Error(`Config fetch failed: ${res.status}`);
  }
  return res.json() as Promise<ClientConfig>;
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
