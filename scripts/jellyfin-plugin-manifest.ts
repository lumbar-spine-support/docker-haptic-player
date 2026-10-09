// Adds a packaged plugin release to the Jellyfin plugin repository manifest (manifest.json).
// Jellyfin polls that file to offer installs and updates; see docs/developer/jellyfin-plugin.md.
//
//   node --import tsx scripts/jellyfin-plugin-manifest.ts \
//     --manifest manifest.json --zip jellyfin-plugin/artifacts/happy_0.1.0.0.zip \
//     --url https://github.com/<owner>/<repo>/releases/download/<tag>/happy_0.1.0.0.zip \
//     [--changelog-file notes.md] [--build-yaml jellyfin-plugin/build.yaml]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';

/** One installable version, as Jellyfin's repository format expects it. */
export interface ManifestVersion {
    version: string;
    changelog: string;
    targetAbi: string;
    sourceUrl: string;
    /** MD5 of the zip, hex. Jellyfin refuses the download when it does not match. */
    checksum: string;
    timestamp: string;
}

export interface ManifestPackage {
    guid: string;
    name: string;
    description: string;
    overview: string;
    owner: string;
    category: string;
    imageUrl?: string;
    versions: ManifestVersion[];
}

/** The fields of jellyfin-plugin/build.yaml that end up in the manifest. */
export interface PluginInfo {
    guid: string;
    name: string;
    description: string;
    overview: string;
    owner: string;
    category: string;
    version: string;
    targetAbi: string;
}

export function readPluginInfo(buildYaml: string): PluginInfo {
    const doc = yaml.load(buildYaml) as Record<string, unknown>;
    const field = (key: keyof PluginInfo): string => {
        const value = doc?.[key];
        if (typeof value !== 'string' || value.trim() === '') throw new Error(`build.yaml: missing "${key}"`);
        return value.trim();
    };
    return {
        guid: field('guid'),
        name: field('name'),
        description: field('description'),
        overview: field('overview'),
        owner: field('owner'),
        category: field('category'),
        version: field('version'),
        targetAbi: field('targetAbi'),
    };
}

/** Compares dotted numeric versions (`0.10.0.0` > `0.9.1.0`); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * Returns the manifest with `entry` added for `info`, replacing an existing entry of the same
 * version (a re-run of the release job). Package metadata is refreshed from `info`; other
 * packages and versions are kept. Versions are sorted newest first, as Jellyfin lists them.
 */
export function upsertVersion(manifest: ManifestPackage[], info: PluginInfo, entry: ManifestVersion): ManifestPackage[] {
    const existing = manifest.find(p => p.guid.toLowerCase() === info.guid.toLowerCase());
    const pkg: ManifestPackage = {
        guid: info.guid,
        name: info.name,
        description: info.description,
        overview: info.overview,
        owner: info.owner,
        category: info.category,
        ...(existing?.imageUrl ? { imageUrl: existing.imageUrl } : {}),
        versions: [...(existing?.versions ?? []).filter(v => v.version !== entry.version), entry]
            .sort((a, b) => compareVersions(b.version, a.version)),
    };
    return existing ? manifest.map(p => (p === existing ? pkg : p)) : [...manifest, pkg];
}

export function md5(data: Buffer): string {
    return createHash('md5').update(data).digest('hex');
}

function main(): void {
    const { values } = parseArgs({
        options: {
            manifest: { type: 'string' },
            zip: { type: 'string' },
            url: { type: 'string' },
            'changelog-file': { type: 'string' },
            'build-yaml': { type: 'string', default: 'jellyfin-plugin/build.yaml' },
        },
    });
    if (!values.manifest || !values.zip || !values.url) {
        throw new Error('Usage: --manifest <manifest.json> --zip <happy_x.y.z.w.zip> --url <download URL> [--changelog-file <file>] [--build-yaml <file>]');
    }

    const info = readPluginInfo(readFileSync(values['build-yaml'], 'utf8'));
    const manifest: ManifestPackage[] = existsSync(values.manifest) ? JSON.parse(readFileSync(values.manifest, 'utf8')) : [];
    const entry: ManifestVersion = {
        version: info.version,
        changelog: values['changelog-file'] ? readFileSync(values['changelog-file'], 'utf8').trim() : '',
        targetAbi: info.targetAbi,
        sourceUrl: values.url,
        checksum: md5(readFileSync(values.zip)),
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    writeFileSync(values.manifest, `${JSON.stringify(upsertVersion(manifest, info, entry), null, 2)}\n`);
    console.log(`Added ${info.name} ${info.version} to ${values.manifest}`);
}

// The package is CommonJS, so tsx runs this as CJS; tests import it without running main().
if (require.main === module) {
    main();
}
