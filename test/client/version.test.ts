import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVersion, versionFromPluginInfo } from '../../src/client/utils/formatVersion';

const TAG = '[client:version]';

test(`${TAG} shortens the prerelease sha and joins it with a dash`, () => {
    assert.equal(
        formatVersion('0.3.1-preview.3d496760c0b4b6a1f9e2d3c4b5a6978877665544'),
        '0.3.1-preview-3d49676',
    );
});

test(`${TAG} leaves stable versions untouched`, () => {
    assert.equal(formatVersion('0.3.1'), '0.3.1');
});

test(`${TAG} leaves prereleases without a sha untouched`, () => {
    assert.equal(formatVersion('0.3.1-preview.3'), '0.3.1-preview.3');
});

test(`${TAG} maps the plugin info, dropping the fourth version part`, () => {
    assert.deepEqual(
        versionFromPluginInfo({ Version: '0.16.0.0', Channel: 'stable', Commit: 'abc', BuiltAt: '2026-10-09T00:00:00Z' }),
        { version: '0.16.0', channel: 'stable', commit: 'abc', builtAt: '2026-10-09T00:00:00Z' },
    );
    assert.deepEqual(
        versionFromPluginInfo({ Version: '0.16.0.1' }),
        { version: '0.16.0.1', channel: 'stable', commit: null, builtAt: null },
    );
});
