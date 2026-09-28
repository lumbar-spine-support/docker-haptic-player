import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import { extractArtwork, isFfprobeAvailable, mapFfprobeOutput, probeMedia } from '../../src/server/services/mediaProbe';

const TAG = '[server:service:mediaProbe]';
const FIXTURES = path.resolve(__dirname, '../fixtures/media');
const EXPECTED_CHAPTERS = [
    { name: 'Introduction', start: 0, end: 180 },
    { name: 'The Butterfly & The Gopher', start: 180, end: 420 },
    { name: "Bunny's Revenge", start: 420, end: 596 },
];

test(`${TAG}: maps tags case-insensitively from container and audio stream`, () => {
    const probe = mapFfprobeOutput({
        format: { duration: '12.5', tags: { TITLE: 'Song', Date: '2021-03-04' } },
        streams: [
            { codec_type: 'audio', tags: { ARTIST: 'Band', title: 'Ignored' } },
            { codec_type: 'video', disposition: { attached_pic: 1 } },
        ],
        chapters: [{ start_time: '0.000000', end_time: '5.000000', tags: { TITLE: 'Intro' } }],
    });
    assert.equal(probe.durationSeconds, 12.5);
    assert.equal(probe.tags.title, 'Song');
    assert.equal(probe.tags.artist, 'Band');
    assert.equal(probe.tags.year, '2021');
    assert.equal(probe.hasArtwork, true);
    assert.deepEqual(probe.chapters, [{ name: 'Intro', start: 0, end: 5 }]);
});

test(`${TAG}: tolerates missing fields`, () => {
    const probe = mapFfprobeOutput({});
    assert.equal(probe.durationSeconds, 0);
    assert.equal(probe.hasArtwork, false);
    assert.deepEqual(probe.chapters, []);
});

for (const ext of ['mp3', 'mp4']) {
    test(`${TAG}: reads embedded chapters from ${ext} fixture`, async (t) => {
        if (!(await isFfprobeAvailable())) return t.skip('ffprobe not installed');
        const probe = await probeMedia(path.join(FIXTURES, `BigBuckBunny_320x180.${ext}`));
        assert.ok(probe.durationSeconds > 590);
        assert.deepEqual(
            probe.chapters.map((c) => ({ name: c.name, start: Math.round(c.start), end: Math.round(c.end ?? 0) })),
            EXPECTED_CHAPTERS,
        );
    });
}

test(`${TAG}: extracts embedded cover art`, async (t) => {
    if (!(await isFfprobeAvailable())) return t.skip('ffmpeg not installed');
    for (const ext of ['mp3', 'mp4']) {
        const cover = await extractArtwork(path.join(FIXTURES, `BigBuckBunny_320x180.${ext}`));
        assert.ok(cover && cover.length > 0, `${ext} cover should be extracted`);
    }
});
