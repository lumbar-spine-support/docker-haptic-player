// Verifies the Jellyfin access tokens HAPPY tabs offer the relay. HAPPY keeps no accounts of its
// own: Jellyfin is the only authority.

import { createLogger } from './logger';

const log = createLogger('[jellyfin-auth]');

/** A valid token stays trusted this long, so relay reconnects do not hit Jellyfin every time. */
const VALID_TTL_MS = 60_000;
/** A rejection is remembered briefly to absorb retries, but not so long that a fresh sign-in is locked out. */
const INVALID_TTL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_CACHE_ENTRIES = 256;

export type TokenVerifier = (token: string | undefined) => Promise<boolean>;

/** Checks tokens with `GET /Users/Me` on the Jellyfin server at `baseUrl`. */
export function createJellyfinTokenVerifier(baseUrl: string, fetchFn: typeof fetch = fetch): TokenVerifier {
  const cache = new Map<string, { valid: boolean; until: number }>();
  const base = baseUrl.replace(/\/+$/, '');

  return async (token) => {
    if (!base || !token || !/^[0-9a-zA-Z]+$/.test(token)) return false;

    const now = Date.now();
    const cached = cache.get(token);
    if (cached && cached.until > now) return cached.valid;

    let valid = false;
    try {
      const res = await fetchFn(`${base}/Users/Me`, {
        headers: { Authorization: `MediaBrowser Client="HAPPY DG-Lab relay", Token="${token}"` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      valid = res.ok;
      if (!valid && res.status !== 401) log.warn(`Jellyfin answered ${res.status} while verifying a token`);
    } catch (err) {
      // Unreachable Jellyfin is not cached: the next attempt retries right away.
      log.warn('Could not reach Jellyfin to verify a token:', err);
      return false;
    }

    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(token, { valid, until: now + (valid ? VALID_TTL_MS : INVALID_TTL_MS) });
    return valid;
  };
}
