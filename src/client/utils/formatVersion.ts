/**
 * Formats a version string for display: shortens the prerelease commit sha to
 * 7 chars and joins it with a dash (`1.2.3-preview.<sha>` becomes
 * `1.2.3-preview-<sha7>`).
 *
 * @param version Raw version string as reported by the server.
 * @returns The display version string.
 */
export function formatVersion(version: string): string {
    return version.replace(/^([^-]+-.*)\.([0-9a-f]{7})[0-9a-f]*$/i, '$1-$2');
}
