import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChaptersVtt, buildStoryboardVtt, formatVttTimestamp } from '../../src/shared/webvtt';

const TAG = '[client:webvtt]';

test(`${TAG}: formatVttTimestamp pads and keeps hours beyond 24`, () => {
    assert.equal(formatVttTimestamp(0), '00:00:00.000');
    assert.equal(formatVttTimestamp(62.5), '00:01:02.500');
    assert.equal(formatVttTimestamp(90_000.25), '25:00:00.250');
});

test(`${TAG}: buildChaptersVtt flattens names and escapes cue arrows`, () => {
    const vtt = buildChaptersVtt([{ name: 'A\n-->B', start: 0, end: 10 }]);
    assert.equal(vtt, 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nA ->B\n');
});

test(`${TAG}: buildStoryboardVtt maps cues onto sheet tiles`, () => {
    const vtt = buildStoryboardVtt(
        { durationSeconds: 25, intervalSeconds: 10, columns: 2, rows: 1, tileWidth: 160, tileHeight: 90, sheets: 2 },
        (n) => `s/${n}.jpg`,
    );
    const cues = vtt.split('\n\n').slice(1);
    assert.equal(cues.length, 3);
    assert.equal(cues[0], '00:00:00.000 --> 00:00:10.000\ns/0.jpg#xywh=0,0,160,90');
    assert.equal(cues[1], '00:00:10.000 --> 00:00:20.000\ns/0.jpg#xywh=160,0,160,90');
    assert.equal(cues[2], '00:00:20.000 --> 00:00:25.000\ns/1.jpg#xywh=0,0,160,90\n');
});

test(`${TAG}: buildStoryboardVtt drops cues beyond the generated sheets`, () => {
    const vtt = buildStoryboardVtt(
        { durationSeconds: 100, intervalSeconds: 10, columns: 2, rows: 2, tileWidth: 1, tileHeight: 1, sheets: 1 },
        (n) => `${n}.jpg`,
    );
    assert.equal(vtt.split('\n\n').length - 1, 4);
});
