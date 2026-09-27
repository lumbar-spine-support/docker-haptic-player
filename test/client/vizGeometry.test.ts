import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaClock, lowerBound, stepPoints } from '../../src/client/components/haptic/visualization/geometry';

const TAG = '[client:vizGeometry]';
const actions = [
    { at: 0, pos: 0 },
    { at: 100, pos: 50 },
    { at: 200, pos: 100 },
];

test(`${TAG} lowerBound finds the first action at or after a time`, () => {
    assert.equal(lowerBound(actions, -1), 0);
    assert.equal(lowerBound(actions, 100), 1);
    assert.equal(lowerBound(actions, 150), 2);
    assert.equal(lowerBound(actions, 300), 3);
});

test(`${TAG} stepPoints holds each position until the next action`, () => {
    assert.deepEqual(stepPoints(actions, 0, 200), [
        [0, 0], [100, 0], [100, 50], [200, 50], [200, 100], [200, 100],
    ]);
});

test(`${TAG} stepPoints starts mid-hold and clips to the window`, () => {
    assert.deepEqual(stepPoints(actions, 50, 150), [[50, 0], [100, 0], [100, 50], [150, 50]]);
});

test(`${TAG} stepPoints is empty outside the script span`, () => {
    assert.deepEqual(stepPoints(actions, 250, 400), []);
    assert.deepEqual(stepPoints(actions, -100, -10), []);
    assert.deepEqual(stepPoints([], 0, 100), []);
});

test(`${TAG} MediaClock extrapolates while playing and freezes when paused`, () => {
    let now = 1000;
    const clock = new MediaClock(() => now);
    clock.sync(10, false, 2);
    now += 500;
    assert.equal(clock.read(100), 11);
    clock.sync(10, false, 2);
    assert.equal(clock.read(100), 11, 'identical update keeps the anchor');
    clock.sync(11.2, true, 2);
    now += 1000;
    assert.equal(clock.read(100), 11.2);
    assert.equal(clock.read(11), 11, 'clamped to duration');
});
