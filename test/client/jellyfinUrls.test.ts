import test from 'node:test';
import assert from 'node:assert/strict';
import { imageUrl, streamUrl, trickplaySheetUrl, trickplayVtt } from '../../src/client/jellyfin/urls';
import type { TrickplayInfo } from '../../src/shared/types';

const TAG = '[client:jellyfin-urls]';
const ENDPOINT = { serverUrl: 'https://jf.example.com', token: 'a&b' };
const TRICKPLAY: TrickplayInfo = {
    mediaSourceId: 'src', resolution: 320, width: 320, height: 180, columns: 2, rows: 2, count: 6, intervalSeconds: 10,
};

test(`${TAG} audio streams use the Audio route, encoded id and token`, () => {
    assert.equal(streamUrl(ENDPOINT, { id: 'a/1', type: 'audio' }),
        'https://jf.example.com/Audio/a%2F1/stream?static=true&ApiKey=a%26b');
    assert.ok(streamUrl(ENDPOINT, { id: 'v', type: 'video' }).startsWith('https://jf.example.com/Videos/v/stream?'));
});

test(`${TAG} image URL without a tag has no tag parameter`, () => {
    for (const tag of [undefined, null, '']) {
        const url = new URL(imageUrl(ENDPOINT.serverUrl, 'i', tag));
        assert.equal(url.searchParams.has('tag'), false);
        assert.equal(url.searchParams.get('maxWidth'), '1000');
        assert.equal(url.searchParams.get('quality'), '90');
    }
});

test(`${TAG} trickplay sheet URL carries media source and token`, () => {
    const url = new URL(trickplaySheetUrl(ENDPOINT, 'v 1', TRICKPLAY, 2));
    assert.equal(url.pathname, '/Videos/v%201/Trickplay/320/2.jpg');
    assert.equal(url.searchParams.get('mediaSourceId'), 'src');
    assert.equal(url.searchParams.get('ApiKey'), 'a&b');
});

test(`${TAG} storyboard without a duration spans the thumbnails Jellyfin made`, () => {
    const vtt = trickplayVtt(ENDPOINT, { id: 'v', durationSeconds: 0, trickplay: TRICKPLAY });
    assert.ok(vtt);
    const cues = vtt.trimEnd().split('\n\n').slice(1);
    assert.equal(cues.length, 6);
    assert.ok(cues[cues.length - 1].startsWith('00:00:50.000 --> 00:01:00.000'));
    // 6 thumbnails at 4 per sheet: the last one is on sheet 1.
    assert.ok(cues[cues.length - 1].includes('/Trickplay/320/1.jpg'));
});
