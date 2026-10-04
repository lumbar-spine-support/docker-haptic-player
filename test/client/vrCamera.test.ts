import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyDrag,
    clampView,
    DEFAULT_CAMERA,
    fromDeviceOrientation,
    perspective,
    rotation,
    wrapDegrees,
} from '../../src/client/components/vr/camera';

const TAG = '[client:vrCamera]';

const close = (actual: number, expected: number, msg?: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-6, `${msg ?? ''} expected ${expected}, got ${actual}`);

/** Camera forward (-Z) in world space. */
const forward = (m: Float32Array) => [-m[8], -m[9], -m[10]];

test(`${TAG} rotation(0, 0) looks down -Z`, () => {
    const [x, y, z] = forward(rotation(0, 0));
    close(x, 0); close(y, 0); close(z, -1);
});

test(`${TAG} positive yaw looks left, positive pitch looks up`, () => {
    const [x] = forward(rotation(90, 0));
    close(x, -1);
    const [, y] = forward(rotation(0, 90));
    close(y, 1);
});

test(`${TAG} perspective matches the requested fov`, () => {
    const m = perspective(90, 2);
    close(m[5], 1);
    close(m[0], 0.5);
    assert.equal(m[11], -1);
});

test(`${TAG} drag moves content with the pointer`, () => {
    const next = applyDrag(DEFAULT_CAMERA, 100, -50, 750);
    close(next.yaw, 10);
    close(next.pitch, -5);
    assert.equal(next.fovY, DEFAULT_CAMERA.fovY);
});

test(`${TAG} clampView keeps the view in the front hemisphere`, () => {
    const v = clampView({ yaw: 500, pitch: -200, fovY: 300 }, 1);
    assert.equal(v.fovY, 100);
    close(v.yaw, 90 - 50);
    assert.equal(v.pitch, -90);
    assert.equal(clampView({ yaw: 0, pitch: 0, fovY: 1 }, 1).fovY, 30);
});

test(`${TAG} clampView narrows yaw for wide viewports`, () => {
    const hFov = (2 * Math.atan(Math.tan((50 * Math.PI) / 180) * 4) * 180) / Math.PI;
    close(clampView({ yaw: 20, pitch: 0, fovY: 100 }, 4).yaw, 90 - hFov / 2);
});

test(`${TAG} device orientation: upright phone facing north looks straight ahead`, () => {
    const o = fromDeviceOrientation(0, 90, 0);
    close(o.yaw, 0); close(o.pitch, 0);
});

test(`${TAG} device orientation: turning left and tilting back`, () => {
    close(fromDeviceOrientation(90, 90, 0).yaw, 90);
    close(fromDeviceOrientation(0, 135, 0).pitch, 45);
    close(fromDeviceOrientation(0, 0, 0).pitch, -90);
});

test(`${TAG} wrapDegrees`, () => {
    assert.equal(wrapDegrees(190), -170);
    assert.equal(wrapDegrees(-190), 170);
    assert.equal(wrapDegrees(180), 180);
});
