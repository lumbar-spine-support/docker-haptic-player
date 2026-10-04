import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVrFormat, vrFormatFromAttribute, vrFormatToAttribute } from '../../src/shared/vrFormat';

const TAG = '[client:vrFormat]';

test(`${TAG} detects side-by-side tokens`, () => {
    for (const name of ['Scene_180_LR.mp4', 'scene.180.sbs.mkv', 'Scene-180-3DH.mp4', 'Scene 180 lr.mp4']) {
        assert.deepEqual(parseVrFormat(name), { fov: 180, layout: 'sbs' }, name);
    }
});

test(`${TAG} detects top-bottom tokens`, () => {
    for (const name of ['Scene_180_TB.mp4', 'scene.180.ou.mp4', 'SCENE-180-3DV.mp4']) {
        assert.deepEqual(parseVrFormat(name), { fov: 180, layout: 'tb' }, name);
    }
});

test(`${TAG} VR180 alone means side-by-side`, () => {
    assert.deepEqual(parseVrFormat('My_VR180_clip.mp4'), { fov: 180, layout: 'sbs' });
});

test(`${TAG} ignores flat files and partial tokens`, () => {
    for (const name of ['Scene.mp4', 'Scene_180.mp4', 'Scene_LR.mp4', 'Scene_1800_LR.mp4', 'Flower_SBSx_180.mp4', 'song.mp3']) {
        assert.equal(parseVrFormat(name), null, name);
    }
});

test(`${TAG} attribute round-trip`, () => {
    assert.equal(vrFormatToAttribute({ fov: 180, layout: 'tb' }), '180-tb');
    assert.deepEqual(vrFormatFromAttribute('180-sbs'), { fov: 180, layout: 'sbs' });
    assert.equal(vrFormatFromAttribute(null), null);
    assert.equal(vrFormatFromAttribute('360-sbs'), null);
});
