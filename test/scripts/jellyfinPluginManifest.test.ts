import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    compareVersions,
    isBeta,
    md5,
    nextBetaVersion,
    pruneBetas,
    readPluginInfo,
    upsertVersion,
    type ManifestPackage,
    type ManifestVersion,
    type PluginInfo,
} from '../../scripts/jellyfin-plugin-manifest';

const INFO: PluginInfo = {
    guid: '98652011-fd1c-4b30-8359-fcae3b45ed37',
    name: 'HAPPY',
    description: 'Indexes funscripts.',
    overview: 'Funscript companion API',
    owner: 'owner',
    category: 'General',
    version: '0.2.0.0',
    targetAbi: '12.1.0.0',
};

function entry(version: string, checksum = 'abc'): ManifestVersion {
    return { version, changelog: '', targetAbi: '12.1.0.0', sourceUrl: `https://example.com/happy_${version}.zip`, checksum, timestamp: '2026-01-01T00:00:00Z' };
}

describe('jellyfin plugin manifest', () => {
    it('reads the manifest fields from the real build.yaml', () => {
        const info = readPluginInfo(readFileSync('jellyfin-plugin/build.yaml', 'utf8'));
        assert.match(info.guid, /^[0-9a-f-]{36}$/);
        assert.match(info.version, /^\d+\.\d+\.\d+\.\d+$/);
        assert.match(info.targetAbi, /^\d+\.\d+\.\d+\.\d+$/);
        assert.equal(info.name, 'HAPPY');
        assert.ok(!info.description.endsWith('\n'));
        assert.match(info.imageUrl ?? '', /^https:\/\/raw\.githubusercontent\.com\/.+\/main\/jellyfin-plugin\/thumb\.png$/);
    });

    it('commits the catalog image as a real PNG', () => {
        // In LFS, raw.githubusercontent.com would serve the pointer file instead of the image.
        assert.equal(readFileSync('jellyfin-plugin/thumb.png').subarray(1, 4).toString(), 'PNG');
    });

    it('takes imageUrl from build.yaml over the one in the manifest', () => {
        const old: ManifestPackage = { ...INFO, imageUrl: 'https://example.com/old.png', versions: [] };
        const [pkg] = upsertVersion([old], { ...INFO, imageUrl: 'https://example.com/new.png' }, entry('0.2.0.0'));
        assert.equal(pkg.imageUrl, 'https://example.com/new.png');
    });

    it('lets the release PR bump build.yaml through its marker, not as YAML', () => {
        // A plain "*.yaml" extra-file makes release-please rewrite `version` as x.y.z and reformat the file.
        const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
        const extraFiles: (string | { type: string; path: string })[] = config.packages['.']['extra-files'];
        assert.deepEqual(extraFiles.filter(f => (typeof f === 'string' ? f : f.path) === 'jellyfin-plugin/build.yaml'),
            [{ type: 'generic', path: 'jellyfin-plugin/build.yaml' }]);
    });

    it('rejects a build.yaml without a required field', () => {
        assert.throws(() => readPluginInfo('name: "HAPPY"\n'), /missing "guid"/);
    });

    it('compares dotted versions numerically', () => {
        assert.ok(compareVersions('0.10.0.0', '0.9.1.0') > 0);
        assert.ok(compareVersions('1.0.0', '1.0.0.0') === 0);
        assert.ok(compareVersions('0.1.0.0', '0.1.0.1') < 0);
    });

    it('creates the package in an empty manifest', () => {
        const result = upsertVersion([], INFO, entry('0.2.0.0'));
        assert.equal(result.length, 1);
        assert.equal(result[0].guid, INFO.guid);
        assert.deepEqual(result[0].versions.map(v => v.version), ['0.2.0.0']);
    });

    it('keeps older versions, sorts newest first and refreshes package metadata', () => {
        const old: ManifestPackage = { ...INFO, overview: 'old', imageUrl: 'https://example.com/i.png', versions: [entry('0.1.0.0'), entry('0.10.0.0')] };
        const other: ManifestPackage = { ...old, guid: 'other', versions: [] };
        const [pkg, kept] = upsertVersion([old, other], INFO, entry('0.2.0.0'));
        assert.deepEqual(pkg.versions.map(v => v.version), ['0.10.0.0', '0.2.0.0', '0.1.0.0']);
        assert.equal(pkg.overview, INFO.overview);
        assert.equal(pkg.imageUrl, 'https://example.com/i.png');
        assert.equal(kept, other);
    });

    it('replaces an existing entry of the same version', () => {
        const old: ManifestPackage = { ...INFO, versions: [entry('0.2.0.0', 'stale')] };
        const [pkg] = upsertVersion([old], INFO, entry('0.2.0.0', 'fresh'));
        assert.deepEqual(pkg.versions.map(v => v.checksum), ['fresh']);
    });

    it('computes the hex MD5 Jellyfin checks downloads against', () => {
        assert.equal(md5(Buffer.from('')), 'd41d8cd98f00b204e9800998ecf8427e');
    });

    it('tells beta builds from stable releases by the fourth part', () => {
        assert.equal(isBeta('1.1.0.0'), false);
        assert.equal(isBeta('1.1.0'), false);
        assert.equal(isBeta('1.1.0.37'), true);
    });

    it('keeps the newest betas above the newest stable and returns the pruned ones', () => {
        const pkg: ManifestPackage = { ...INFO, versions: ['1.1.0.0', '1.1.0.3', '1.1.0.2', '1.1.0.1', '1.0.0.0'].map(v => entry(v)) };
        const { manifest: [kept], removed } = pruneBetas([pkg], INFO.guid, 2);
        assert.deepEqual(kept.versions.map(v => v.version), ['1.1.0.0', '1.1.0.3', '1.1.0.2', '1.0.0.0']);
        assert.deepEqual(removed.map(v => v.version), ['1.1.0.1']);
    });

    it('drops every beta once a newer stable is released', () => {
        const pkg: ManifestPackage = { ...INFO, versions: ['1.2.0.0', '1.1.0.5', '1.1.0.4', '1.1.0.0'].map(v => entry(v)) };
        const { manifest: [kept], removed } = pruneBetas([pkg], INFO.guid, 5);
        assert.deepEqual(kept.versions.map(v => v.version), ['1.2.0.0', '1.1.0.0']);
        assert.deepEqual(removed.map(v => v.sourceUrl), ['https://example.com/happy_1.1.0.5.zip', 'https://example.com/happy_1.1.0.4.zip']);
    });

    it('numbers the next beta on top of the newest stable', () => {
        const pkg = (...versions: string[]): ManifestPackage[] => [{ ...INFO, versions: versions.map(v => entry(v)) }];
        assert.equal(nextBetaVersion([], INFO.guid, '1.1.0.0'), '1.1.0.1');
        assert.equal(nextBetaVersion(pkg('1.1.0.0'), INFO.guid, '1.1.0.0'), '1.1.0.1');
        assert.equal(nextBetaVersion(pkg('1.1.0.9', '1.1.0.10', '1.1.0.0'), INFO.guid, '1.1.0.0'), '1.1.0.11');
        // Released on main while dev's build.yaml still says 1.1.0: betas go on top of 1.2.0.
        assert.equal(nextBetaVersion(pkg('1.2.0.0', '1.1.0.4', '1.1.0.0'), INFO.guid, '1.1.0.0'), '1.2.0.1');
        assert.equal(nextBetaVersion(pkg('1.1.0.0'), INFO.guid, '1.2.0.0'), '1.2.0.1');
    });

    it('leaves the manifest alone when there is nothing to prune', () => {
        const manifest: ManifestPackage[] = [{ ...INFO, versions: [entry('1.1.0.1'), entry('1.1.0.0')] }];
        const result = pruneBetas(manifest, INFO.guid, 5);
        assert.equal(result.manifest, manifest);
        assert.deepEqual(result.removed, []);
        assert.deepEqual(pruneBetas(manifest, 'unknown', 0).removed, []);
    });
});
