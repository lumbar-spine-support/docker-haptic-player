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
 * (Jellyfin needs four parts), so `0.16.0.0` is shown as `0.16.0`. Beta builds keep
 * their build number (`0.16.0.37`).
 */
export function versionFromPluginInfo(info: PluginInfo): VersionInfo {
    return {
        version: info.Version.replace(/^(\d+\.\d+\.\d+)\.0$/, '$1'),
        channel: info.Channel ?? 'stable',
        commit: info.Commit ?? null,
        builtAt: info.BuiltAt ?? null,
    };
}

/** What the version badge in the side menu shows. */
export interface VersionBadge {
    text: string;
    title: string;
    /** Highlight the badge: a beta or dev build, not a release. */
    prerelease: boolean;
}

/** The version badge for `info`: beta and dev builds name their channel (`v1.1.0.37 beta`). */
export function versionBadge(info: VersionInfo): VersionBadge {
    const prerelease = info.channel !== 'stable';
    const commit = info.commit ? ` (commit ${info.commit.slice(0, 7)})` : '';
    return {
        text: `v${formatVersion(info.version)}${prerelease ? ` ${info.channel}` : ''}`,
        title: prerelease ? `${info.channel === 'beta' ? 'Beta build' : 'Development build'} ${info.version}${commit}` : `${info.version}${commit}`,
        prerelease,
    };
}
