import type { VersionInfo } from '../../shared/types';

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

/** `GET /Happy/Info` of the HAPPY Jellyfin plugin. */
export interface PluginInfo {
    Version: string;
    Channel?: string;
    Commit?: string | null;
    BuiltAt?: string | null;
}

/**
 * HAPPY's version info from the plugin's: the plugin version is HAPPY's plus `.0`
 * (Jellyfin needs four parts), so `0.16.0.0` is shown as `0.16.0`.
 */
export function versionFromPluginInfo(info: PluginInfo): VersionInfo {
    return {
        version: info.Version.replace(/^(\d+\.\d+\.\d+)\.0$/, '$1'),
        channel: info.Channel ?? 'stable',
        commit: info.Commit ?? null,
        builtAt: info.BuiltAt ?? null,
    };
}
