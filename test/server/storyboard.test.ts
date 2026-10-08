import test from 'node:test';
import assert from 'node:assert/strict';

import { TAG, buildStoryboardArgs } from '../../src/server/services/storyboard';
import { startTestServer, httpGet, httpGetBuffer } from '../helpers/index';
import type { LibraryResponse } from '../../src/shared/types';

test(`${TAG} buildStoryboardArgs decodes keyframes and tiles frames`, () => {
    const args = buildStoryboardArgs('/media/a.mp4', null, 10, 240, '/tmp/out');
    assert.ok(args.indexOf('-skip_frame') < args.indexOf('-i'), '-skip_frame must precede the input');
    assert.equal(args[args.indexOf('-vf') + 1], 'fps=1/10,scale=240:-2,tile=10x10');
    assert.equal(args.at(-1), '/tmp/out/%d.jpg');
});

test(`${TAG} buildStoryboardArgs crops one eye of VR180 videos`, () => {
    const sbs = buildStoryboardArgs('a', { fov: 180, layout: 'sbs' }, 5, 160, 'o');
    const tb = buildStoryboardArgs('a', { fov: 180, layout: 'tb' }, 5, 160, 'o');
    assert.match(sbs[sbs.indexOf('-vf') + 1], /^crop=iw\/2:ih:0:0,/);
    assert.match(tb[tb.indexOf('-vf') + 1], /^crop=iw:ih\/2:0:0,/);
});

test(`${TAG} serves storyboard and chapter WebVTT plus sprite sheets`, async () => {
    const server = await startTestServer(undefined, { storyboardGenerate: true, storyboardInterval: 2, storyboardWidth: 80 });
    try {
        const { body } = await httpGet(server.port, '/api/library');
        const library = body as LibraryResponse;
        const video = library.videos.find((v) => v.filename === 'BigBuckBunny_320x180.mp4');
        const audio = library.tracks[0];
        assert.ok(video && audio);

        const vtt = await httpGet(server.port, `/api/media/${video.id}/storyboard.vtt`);
        assert.equal(vtt.status, 200);
        assert.match(String(vtt.headers['content-type']), /^text\/vtt/);
        const sheet = /\n(storyboard\/[a-f0-9]{40}\/0\.jpg)#xywh=0,0,80,\d+\n/.exec(vtt.text);
        assert.ok(sheet, vtt.text.slice(0, 200));

        const image = await httpGetBuffer(server.port, `/api/media/${video.id}/${sheet[1]}`);
        assert.equal(image.status, 200);
        assert.match(String(image.headers['cache-control']), /immutable/);
        assert.equal(image.buffer.subarray(0, 2).toString('hex'), 'ffd8');

        assert.equal((await httpGet(server.port, `/api/media/${audio.id}/storyboard.vtt`)).status, 404);
        assert.equal((await httpGet(server.port, `/api/media/${video.id}/storyboard/..%2F..%2Fsettings/0.jpg`)).status, 404);
        assert.equal((await httpGet(server.port, `/api/media/${video.id}/storyboard/${'0'.repeat(40)}/0.jpg`)).status, 404);

        const withChapters = [...library.tracks, ...library.videos].find((t) => t.chapters?.length);
        if (withChapters) {
            const chapters = await httpGet(server.port, `/api/media/${withChapters.id}/chapters.vtt`);
            assert.equal(chapters.status, 200);
            assert.ok(chapters.text.startsWith('WEBVTT\n\n'));
        }
        const without = [...library.tracks, ...library.videos].find((t) => !t.chapters?.length);
        if (without) assert.equal((await httpGet(server.port, `/api/media/${without.id}/chapters.vtt`)).status, 404);
    } finally {
        await server.close();
    }
});
