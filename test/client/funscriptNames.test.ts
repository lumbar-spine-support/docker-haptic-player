import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FUNSCRIPT_SUFFIXES, parseFunscriptChapters, parseFunscriptName } from '../../src/shared/funscriptNames';

const TAG = '[shared:funscriptNames]';

test(`${TAG} typed, subcategory and untyped names`, () => {
    assert.deepEqual(parseFunscriptName('Clip.stroker.funscript'), { stem: 'clip', type: 'stroker' });
    assert.deepEqual(parseFunscriptName('Clip.estim.Nipples.funscript'), { stem: 'clip', type: 'estim', sub: 'Nipples' });
    assert.deepEqual(parseFunscriptName('Clip.funscript'), { stem: 'clip', type: 'unknown' });
    assert.deepEqual(parseFunscriptName('Clip.custom.funscript'), { stem: 'clip.custom', type: 'unknown' });
});

test(`${TAG} ignores directories and non-funscript files`, () => {
    assert.deepEqual(parseFunscriptName('a/b/Clip.vibrator.funscript'), { stem: 'clip', type: 'vibrator' });
    assert.equal(parseFunscriptName('Clip.json'), null);
});

test(`${TAG} honours configured suffixes and separator`, () => {
    const suffixes = { ...DEFAULT_FUNSCRIPT_SUFFIXES, separator: '_', stroker: 'Main' };
    assert.deepEqual(parseFunscriptName('clip_main.funscript', suffixes), { stem: 'clip', type: 'stroker' });
    assert.deepEqual(parseFunscriptName('clip.stroker.funscript', suffixes), { stem: 'clip.stroker', type: 'unknown' });
});

test(`${TAG} reads OFS/MultiFunPlayer chapters and skips invalid entries`, () => {
    const chapters = parseFunscriptChapters({
        actions: [],
        metadata: {
            chapters: [
                { name: 'Intro', startTime: '00:00:01.500', endTime: '00:00:10.000' },
                { name: 'Main', startTime: 12000 },
                { name: 'Broken', startTime: 'later' },
                null,
            ],
        },
    });
    assert.deepEqual(chapters, [
        { name: 'Intro', start: 1.5, end: 10 },
        { name: 'Main', start: 12, end: undefined },
    ]);
    assert.deepEqual(parseFunscriptChapters({ actions: [] }), []);
});
