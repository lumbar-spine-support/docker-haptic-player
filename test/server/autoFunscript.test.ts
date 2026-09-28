import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { Config } from '../../src/server/config';
import {
    TAG,
    analyzeSamples,
    createAutoFunscriptService,
    isFfmpegAvailable,
    renderDebugImage,
    resolveAutoscriptType,
    resolveSettings,
} from '../../src/server/services/autoFunscript';
import { setLogLevel } from '../../src/server/utils/logger';
import type { TrackInfo } from '../../src/shared/types';

const SAMPLE_RATE = 8000;
const settings = resolveSettings({ ...Config.DEFAULT_SERVER_CONFIG });

function tone(frequency: number, seconds: number, envelope: (t: number) => number): Float32Array {
    const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
    for (let i = 0; i < samples.length; i++) {
        const t = i / SAMPLE_RATE;
        samples[i] = envelope(t) * Math.sin(2 * Math.PI * frequency * t);
    }
    return samples;
}

test(`${TAG} positions follow the amplitude of an in-band tone and peak at 100`, () => {
    const analysis = analyzeSamples(tone(100, 10, (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * 0.2 * t)), SAMPLE_RATE, settings);
    const positions = analysis.actions.map((a) => a.pos);
    assert.equal(Math.max(...positions), 100);
    const peak = analysis.actions.find((a) => a.pos === 100)!;
    assert.ok(Math.abs(peak.at - 2500) < 300, `peak at ${peak.at}ms`);
    assert.ok(analysis.actions.some((a) => a.pos === 0 && a.at > 4500 && a.at < 5500));
});

test(`${TAG} an out-of-band tone stays near zero`, () => {
    const analysis = analyzeSamples(tone(1000, 3, () => 1), SAMPLE_RATE, settings);
    assert.ok(analysis.actions.every((a) => a.pos <= 5), JSON.stringify(analysis.actions.slice(0, 5)));
});

test(`${TAG} silence produces a flat zero script`, () => {
    const analysis = analyzeSamples(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE, settings);
    assert.ok(analysis.actions.length > 0);
    assert.ok(analysis.actions.every((a) => a.pos === 0));
});

test(`${TAG} values below minPower are clamped to zero`, () => {
    const strict = { ...settings, minPower: 0.9, minPositionDelta: 0 };
    const analysis = analyzeSamples(tone(100, 10, (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * 0.2 * t)), SAMPLE_RATE, strict);
    assert.ok(analysis.actions.every((a) => a.pos === 0 || a.pos >= 90));
});

test(`${TAG} resolveAutoscriptType maps generic to the unknown channel`, () => {
    const originalWarn = console.warn;
    console.warn = () => { };
    try {
        assert.equal(resolveAutoscriptType('generic'), 'unknown');
        assert.equal(resolveAutoscriptType('Vibrator'), 'vibrator');
        assert.equal(resolveAutoscriptType('bogus'), 'unknown');
    } finally {
        console.warn = originalWarn;
    }
});

test(`${TAG} debug image has the expected dimensions`, () => {
    const analysis = analyzeSamples(tone(100, 2, () => 1), SAMPLE_RATE, settings);
    const image = renderDebugImage(analysis, settings);
    assert.equal(image.pixels.length, image.width * image.height * 3);
});

test(`${TAG} debug image is written only on debug log level`, { skip: !isFfmpegAvailable() && 'ffmpeg not installed' }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoscript-test-'));
    const mediaDir = path.join(root, 'media');
    fs.mkdirSync(mediaDir);
    const wav = path.join(mediaDir, 'tone.wav');
    const samples = tone(100, 2, () => 1);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + samples.length * 2, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(samples.length * 2, 40);
    const body = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => body.writeInt16LE(Math.round(s * 32767), i * 2));
    fs.writeFileSync(wav, Buffer.concat([header, body]));

    const track = { id: 'dG9uZS53YXY', filename: 'tone.wav', artworkVersion: 1 } as TrackInfo;
    const dir = Config.autoscriptCacheDirPath(root);
    try {
        for (const [level, expected] of [['info', false], ['debug', true]] as const) {
            setLogLevel(level);
            const service = createAutoFunscriptService({ ...Config.DEFAULT_SERVER_CONFIG, mediaDir, configDir: root, autoscriptFrameMs: level === 'info' ? 50 : 60 });
            const script = await service.get(track);
            assert.ok(script.actions.length > 0);
            const png = path.join(dir, `${service.key(track.id, track.artworkVersion)}.debug.png`);
            assert.equal(fs.existsSync(png), expected, level);
        }
    } finally {
        setLogLevel(undefined);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
