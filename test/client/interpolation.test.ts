import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isInterpolationMethod,
    positionAt,
    prepareScript,
    segmentPosition,
    segmentSpeed,
} from '../../src/shared/interpolation';

const TAG = '[shared:interpolation]';
const near = (actual: number | null, expected: number): void => {
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
};
const actions = [
    { at: 100, pos: 100 },
    { at: 0, pos: 0 },
    { at: 100, pos: 40 },
    { at: 200, pos: 40 },
];

test(`${TAG} prepareScript sorts actions`, () => {
    assert.deepEqual(prepareScript(actions, 'linear').actions.map((a) => a.at), [0, 100, 100, 200]);
});

test(`${TAG} linear blends between neighbouring points`, () => {
    near(positionAt(prepareScript(actions, 'linear'), 25), 25);
});

test(`${TAG} none holds the last point`, () => {
    const script = prepareScript(actions, 'none');
    near(positionAt(script, 99), 0);
    near(positionAt(script, 150), 40);
    near(segmentPosition(script, 0, 100), 0);
});

test(`${TAG} duplicate timestamps resolve to the later point`, () => {
    near(positionAt(prepareScript(actions, 'linear'), 100), 40);
});

test(`${TAG} positions outside the scripted range are null`, () => {
    const script = prepareScript(actions, 'pchip');
    assert.equal(positionAt(script, -1), null);
    assert.equal(positionAt(script, 201), null);
    assert.equal(positionAt(prepareScript([], 'pchip'), 0), null);
});

test(`${TAG} pchip passes through every point without overshoot`, () => {
    const pts = [
        { at: 0, pos: 0 }, { at: 100, pos: 30 }, { at: 150, pos: 100 },
        { at: 400, pos: 90 }, { at: 500, pos: 0 },
    ];
    const script = prepareScript(pts, 'pchip');
    for (const p of pts) near(positionAt(script, p.at), p.pos);
    for (let ms = 0; ms <= 500; ms += 5) {
        const k = Math.min(pts.filter((p) => p.at <= ms).length - 1, pts.length - 2);
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const pos = positionAt(script, ms)!;
        assert.ok(pos >= Math.min(a.pos, b.pos) - 1e-9 && pos <= Math.max(a.pos, b.pos) + 1e-9, `no overshoot at ${ms}`);
    }
});

test(`${TAG} pchip keeps moving through monotone points and stops at turning points`, () => {
    const pts = [{ at: 0, pos: 0 }, { at: 100, pos: 50 }, { at: 200, pos: 100 }, { at: 300, pos: 0 }];
    const script = prepareScript(pts, 'pchip');
    assert.ok(segmentSpeed(script, 1, 100) > 0, 'no stall mid-run');
    near(segmentSpeed(script, 2, 200), 0);
});

test(`${TAG} speed is the derivative in units per second`, () => {
    near(segmentSpeed(prepareScript([{ at: 0, pos: 0 }, { at: 100, pos: 50 }], 'linear'), 0, 50), 500);
    near(segmentSpeed(prepareScript([{ at: 0, pos: 0 }, { at: 100, pos: 50 }], 'none'), 0, 50), 500);
});

test(`${TAG} method names are validated`, () => {
    assert.ok(isInterpolationMethod('pchip'));
    assert.ok(isInterpolationMethod('none'));
    assert.ok(!isInterpolationMethod('smooth'));
    assert.ok(!isInterpolationMethod(1));
});
