import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import { normalizeRelativePath, resolveMediaPath } from '../../../src/server/utils/paths';

const TAG = '[server:utils:paths]';

test(`${TAG} normalizeRelativePath converts backslashes to forward slashes`, () => {
  assert.equal(normalizeRelativePath('Album\\Track.mp3'), 'Album/Track.mp3');
});

test(`${TAG} normalizeRelativePath strips a single leading ./`, () => {
  assert.equal(normalizeRelativePath('./Album/Track.mp3'), 'Album/Track.mp3');
});

test(`${TAG} normalizeRelativePath strips leading slashes`, () => {
  assert.equal(normalizeRelativePath('///Album/Track.mp3'), 'Album/Track.mp3');
});

test(`${TAG} resolveMediaPath resolves a plain relative path inside the media root`, () => {
  const mediaRoot = '/media';
  const result = resolveMediaPath(mediaRoot, 'Album/Track.mp3');
  assert.equal(result, path.join(mediaRoot, 'Album', 'Track.mp3'));
});

test(`${TAG} resolveMediaPath rejects paths that escape the media root via ../`, () => {
  assert.equal(resolveMediaPath('/media', '../etc/passwd'), null);
  assert.equal(resolveMediaPath('/media', 'Album/../../etc/passwd'), null);
});

test(`${TAG} resolveMediaPath treats a leading-slash path as relative to the media root, not the filesystem root`, () => {
  // normalizeRelativePath strips leading slashes, so this stays confined to mediaRoot instead of reaching /etc/passwd.
  assert.equal(resolveMediaPath('/media', '/etc/passwd'), path.join('/media', 'etc', 'passwd'));
});

test(`${TAG} resolveMediaPath rejects the media root itself`, () => {
  assert.equal(resolveMediaPath('/media', ''), null);
  assert.equal(resolveMediaPath('/media', '.'), null);
});

test(`${TAG} resolveMediaPath rejects a sibling directory that merely shares a name prefix`, () => {
  // Guards against a naive startsWith(mediaRoot) check that would wrongly allow /media-other/secret.
  assert.equal(resolveMediaPath('/media', '../media-other/secret.mp3'), null);
});
