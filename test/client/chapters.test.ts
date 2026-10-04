import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeChapters, normalizeChapters, parseTimestamp } from '../../src/shared/chapters';
import { snapToChapter } from '../../@/components/videojs/features/chapters';

const TAG = '[client:chapters]';

test(`${TAG}: parseTimestamp accepts OFS timestamps and milliseconds`, () => {
    assert.equal(parseTimestamp('00:01:02.500'), 62.5);
    assert.equal(parseTimestamp('01:02'), 62);
    assert.equal(parseTimestamp(1500), 1.5);
    assert.equal(parseTimestamp('garbage'), null);
});

test(`${TAG}: normalizeChapters sorts and fills missing ends`, () => {
    const chapters = normalizeChapters([{ name: 'B', start: 10 }, { name: 'A', start: 0 }], 30);
    assert.deepEqual(chapters, [
        { name: 'A', start: 0, end: 10 },
        { name: 'B', start: 10, end: 30 },
    ]);
});

test(`${TAG}: mergeChapters drops duplicates across sources`, () => {
    const merged = mergeChapters([
        [{ name: 'A', start: 0 }, { name: 'B', start: 10 }],
        [{ name: 'B', start: 10.2 }, { name: 'C', start: 20 }],
    ]);
    assert.deepEqual(merged.map((c) => c.name), ['A', 'B', 'C']);
});

test(`${TAG}: snapToChapter snaps only within threshold`, () => {
    const chapters = [0, 10];
    assert.equal(snapToChapter(10.4, chapters, 0.5), 10);
    assert.equal(snapToChapter(11, chapters, 0.5), 11);
});
