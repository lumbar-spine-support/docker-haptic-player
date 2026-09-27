import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaClock, curvePoints, heatColor, HEAT_MAX_SPEED } from '../../src/client/components/haptic/visualization/geometry';
import { prepareScript, type InterpolationMethod } from '../../src/shared/interpolation';

const TAG = '[client:vizGeometry]';
const actions = [
    { at: 0, pos: 0 },
    { at: 100, pos: 50 },
    { at: 200, pos: 100 },
];
const xy = (points: ReturnType<typeof curvePoints>): Array<[number, number]> => points.map((p) => [p.ms, p.pos]);
const prep = (method: InterpolationMethod) => prepareScript(actions, method);

test(`${TAG} none holds each position until the next action`, () => {
    assert.deepEqual(xy(curvePoints(prep('none'), 0, 200, 1)), [
        [0, 0], [100, 0], [100, 50], [200, 50], [200, 100],
    ]);
});

test(`${TAG} none starts mid-hold and clips to the window`, () => {
    assert.deepEqual(xy(curvePoints(prep('none'), 50, 150, 1)), [[50, 0], [100, 0], [100, 50], [150, 50]]);
});

test(`${TAG} linear curve clips segments at the window edges`, () => {
    assert.deepEqual(xy(curvePoints(prep('linear'), 50, 150, 1)), [[50, 25], [100, 50], [150, 75]]);
});

test(`${TAG} pchip curve is sampled at the requested resolution`, () => {
    const points = curvePoints(prep('pchip'), 0, 100, 25);
    assert.equal(points.length, 5);
    for (const p of points) assert.ok(Math.abs(p.pos - p.ms / 2) < 1e-9, 'straight data stays straight');
});

test(`${TAG} curve speed is the derivative in units per second`, () => {
    const [, first] = curvePoints(prep('linear'), 0, 100, 1);
    assert.ok(Math.abs(first!.speed - 500) < 1e-9);
});

test(`${TAG} curve is empty outside the script span`, () => {
    assert.deepEqual(curvePoints(prep('linear'), 250, 400, 1), []);
    assert.deepEqual(curvePoints(prep('none'), -100, -10, 1), []);
    assert.deepEqual(curvePoints(prepareScript([], 'pchip'), 0, 100, 1), []);
});

test(`${TAG} heatColor runs from blue to red and saturates`, () => {
    assert.equal(heatColor(0), 'hsl(240, 90%, 55%)');
    assert.equal(heatColor(HEAT_MAX_SPEED), 'hsl(0, 90%, 55%)');
    assert.equal(heatColor(HEAT_MAX_SPEED * 3), heatColor(HEAT_MAX_SPEED));
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
