/**
 * Path resolution helpers shared by routes/services that serve files from a media directory.
 * Centralized here (rather than duplicated per-route) so the traversal guard has one tested implementation.
 */

import path from 'path';

/** Normalizes a stored/relative path to forward slashes with no leading `./` or `/`. */
export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

/**
 * Resolves a relative path against a media root, rejecting anything that would escape the root
 * (e.g. `../`, absolute paths, or the root itself). Returns null when the path is not allowed.
 */
export function resolveMediaPath(mediaDir: string, relativePath: string): string | null {
  const mediaRoot = path.resolve(mediaDir);
  const normalized = normalizeRelativePath(relativePath);
  const absolute = path.resolve(mediaRoot, normalized);

  if (absolute === mediaRoot || !absolute.startsWith(`${mediaRoot}${path.sep}`)) {
    return null;
  }

  return absolute;
}
