import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyArtAspect } from '../../src/client/utils/artAspect';

const TAG = '[client:artAspect]';

test(`${TAG} classifies widescreen art as landscape`, () => {
    assert.equal(classifyArtAspect(1920, 1080), 'landscape');
    assert.equal(classifyArtAspect(120, 100), 'landscape');
});

test(`${TAG} classifies near-square art as square`, () => {
    assert.equal(classifyArtAspect(500, 500), 'square');
    assert.equal(classifyArtAspect(119, 100), 'square');
    assert.equal(classifyArtAspect(100, 119), 'square');
});

test(`${TAG} classifies tall art as portrait`, () => {
    assert.equal(classifyArtAspect(1080, 1920), 'portrait');
    assert.equal(classifyArtAspect(100, 120), 'portrait');
});

test(`${TAG} treats missing dimensions as square`, () => {
    assert.equal(classifyArtAspect(0, 0), 'square');
});
