// Adds a packaged plugin release to the Jellyfin plugin repository manifest (manifest.json).
// Jellyfin polls that file to offer installs and updates; see docs/developer/jellyfin-plugin.md.
//
//   node --import tsx scripts/jellyfin-plugin-manifest.ts \
//     --manifest manifest.json --zip jellyfin-plugin/artifacts/happy_0.1.0.0.zip \
//     --url https://github.com/<owner>/<repo>/releases/download/<tag>/happy_0.1.0.0.zip \
//     [--changelog-file notes.md] [--build-yaml jellyfin-plugin/build.yaml]
//     [--version 0.1.0.42] [--prune-betas 5 --pruned-file pruned.txt] [--seed manifest.json]
//
//   node --import tsx scripts/jellyfin-plugin-manifest.ts --manifest manifest-beta.json --next-beta
//     prints the version for the next beta build (e.g. 0.1.0.43).
//
// Stable versions end in .0; beta builds (the beta repository, manifest-beta.json) number the
// fourth part, e.g. 0.1.0.42, so they sort above the stable they are based on and below the next one.
// --seed starts a missing manifest from another one (the beta manifest from the stable one).

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
    /** Card image in Jellyfin's plugin catalog; optional. */
    imageUrl?: string;
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
        ...(typeof doc?.imageUrl === 'string' && doc.imageUrl.trim() ? { imageUrl: doc.imageUrl.trim() } : {}),
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
 * version (a re-run of the release job). Package metadata is refreshed from `info` (the
 * manifest's `imageUrl` is kept when `info` has none); other packages and versions are kept. Versions are sorted newest first, as Jellyfin lists them.
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
        ...(info.imageUrl || existing?.imageUrl ? { imageUrl: info.imageUrl || existing?.imageUrl } : {}),
        versions: [...(existing?.versions ?? []).filter(v => v.version !== entry.version), entry]
            .sort((a, b) => compareVersions(b.version, a.version)),
    };
    return existing ? manifest.map(p => (p === existing ? pkg : p)) : [...manifest, pkg];
}

/** A beta build: the fourth version part is set (stable releases are `x.y.z.0`). */
export function isBeta(version: string): boolean {
    return (Number(version.split('.')[3]) || 0) > 0;
}

/**
 * Drops beta versions of package `guid` that are older than its newest stable version (the
 * beta has been released) and keeps at most `keep` of the remaining ones, newest first.
 * Returns the manifest without them and the removed entries, whose zips can then be deleted.
 */
export function pruneBetas(manifest: ManifestPackage[], guid: string, keep: number): { manifest: ManifestPackage[]; removed: ManifestVersion[] } {
    const pkg = manifest.find(p => p.guid.toLowerCase() === guid.toLowerCase());
    if (!pkg) return { manifest, removed: [] };
    const newestStable = pkg.versions.filter(v => !isBeta(v.version))
        .reduce<string | null>((max, v) => (max === null || compareVersions(v.version, max) > 0 ? v.version : max), null);
    const betas = pkg.versions.filter(v => isBeta(v.version))
        .sort((a, b) => compareVersions(b.version, a.version));
    const current = betas.filter(v => newestStable === null || compareVersions(v.version, newestStable) > 0).slice(0, Math.max(0, keep));
    const removed = betas.filter(v => !current.includes(v));
    if (removed.length === 0) return { manifest, removed };
    const kept: ManifestPackage = { ...pkg, versions: pkg.versions.filter(v => !removed.includes(v)) };
    return { manifest: manifest.map(p => (p === pkg ? kept : p)), removed };
}

/**
 * The version of the next beta build: one above the newest beta on top of the newest stable,
 * either the one in the manifest or `stable` (build.yaml), whichever is higher. Dev can lag behind
 * the release on main, so the manifest is what keeps betas above the latest stable.
 */
export function nextBetaVersion(manifest: ManifestPackage[], guid: string, stable: string): string {
    const base = (version: string) => version.split('.').slice(0, 3).map(part => Number(part) || 0).join('.');
    const versions = manifest.find(p => p.guid.toLowerCase() === guid.toLowerCase())?.versions.map(v => v.version) ?? [];
    const newestBase = [stable, ...versions].map(base).reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
    const build = versions.filter(v => isBeta(v) && base(v) === newestBase)
        .reduce((max, v) => Math.max(max, Number(v.split('.')[3])), 0);
    return `${newestBase}.${build + 1}`;
}

export function md5(data: Buffer): string {
    return createHash('md5').update(data).digest('hex');
}

function readManifest(path: string, seed: string | undefined): ManifestPackage[] {
    const source = existsSync(path) ? path : seed && existsSync(seed) ? seed : null;
    return source ? JSON.parse(readFileSync(source, 'utf8')) : [];
}

function main(): void {
    const { values } = parseArgs({
        options: {
            manifest: { type: 'string' },
            seed: { type: 'string' },
            zip: { type: 'string' },
            url: { type: 'string' },
            'changelog-file': { type: 'string' },
            'build-yaml': { type: 'string', default: 'jellyfin-plugin/build.yaml' },
            version: { type: 'string' },
            'prune-betas': { type: 'string' },
            'pruned-file': { type: 'string' },
            'next-beta': { type: 'boolean', default: false },
        },
    });
    if (values.manifest && values['next-beta']) {
        const info = readPluginInfo(readFileSync(values['build-yaml'], 'utf8'));
        console.log(nextBetaVersion(readManifest(values.manifest, values.seed), info.guid, info.version));
        return;
    }
    if (!values.manifest || !values.zip || !values.url) {
        throw new Error('Usage: --manifest <manifest.json> [--seed <manifest.json>] (--next-beta | --zip <happy_x.y.z.w.zip> --url <download URL> [--changelog-file <file>] [--build-yaml <file>] [--version <x.y.z.w>] [--prune-betas <n> [--pruned-file <file>]])');
    }
    if (values.version !== undefined && !/^\d+\.\d+\.\d+\.\d+$/.test(values.version)) throw new Error(`--version: expected x.y.z.w, got "${values.version}"`);
    const keep = values['prune-betas'] === undefined ? null : Number(values['prune-betas']);
    if (keep !== null && !(Number.isInteger(keep) && keep >= 0)) throw new Error(`--prune-betas: expected a count, got "${values['prune-betas']}"`);

    const parsed = readPluginInfo(readFileSync(values['build-yaml'], 'utf8'));
    const info = values.version ? { ...parsed, version: values.version } : parsed;
    const manifest = readManifest(values.manifest, values.seed);
    const entry: ManifestVersion = {
        version: info.version,
        changelog: values['changelog-file'] ? readFileSync(values['changelog-file'], 'utf8').trim() : '',
        targetAbi: info.targetAbi,
        sourceUrl: values.url,
        checksum: md5(readFileSync(values.zip)),
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    let updated = upsertVersion(manifest, info, entry);
    let removed: ManifestVersion[] = [];
    if (keep !== null) ({ manifest: updated, removed } = pruneBetas(updated, info.guid, keep));

    writeFileSync(values.manifest, `${JSON.stringify(updated, null, 2)}\n`);
    console.log(`Added ${info.name} ${info.version} to ${values.manifest}`);
    for (const v of removed) console.log(`Pruned beta ${v.version}`);
    // One download URL per line, so the workflow can delete the zips of the pruned betas.
    if (values['pruned-file']) writeFileSync(values['pruned-file'], removed.map(v => `${v.sourceUrl}\n`).join(''));
}

// The package is CommonJS, so tsx runs this as CJS; tests import it without running main().
if (require.main === module) {
    main();
}
