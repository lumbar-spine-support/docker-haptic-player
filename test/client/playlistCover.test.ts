import test from 'node:test';
import assert from 'node:assert/strict';
import type { TrackInfo } from '../../src/shared/types';

const TAG = '[client:playlistCover]';

type DrawCall = { src: string; dx: number; dy: number; dw: number; dh: number; sx: number; sy: number; side: number };

let artwork: typeof import('../../src/client/utils/artwork');
let draws: DrawCall[] = [];
let canvasCount = 0;

// Minimal Image/canvas stand-ins: sources containing "broken" fail to load, others are 300x200.
class FakeImage {
    naturalWidth = 300;
    naturalHeight = 200;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';
    get src(): string { return this._src; }
    set src(value: string) {
        this._src = value;
        queueMicrotask(() => (value.includes('broken') ? this.onerror?.() : this.onload?.()));
    }
}

function fakeCanvas() {
    canvasCount++;
    return {
        width: 0,
        height: 0,
        getContext: () => ({
            fillStyle: '',
            fillRect: () => { },
            drawImage: (img: FakeImage, sx: number, sy: number, side: number, _sh: number, dx: number, dy: number, dw: number, dh: number) => {
                draws.push({ src: img.src, sx, sy, side, dx, dy, dw, dh });
            },
        }),
        toDataURL: () => `data:image/jpeg;collage-${canvasCount}`,
    };
}

function track(id: string, hasArtwork = true): TrackInfo {
    return { id, hasArtwork, artworkVersion: 1 } as TrackInfo;
}

test.before(async () => {
    (globalThis as any).window = { location: { href: 'http://localhost/' } };
    (globalThis as any).document = {
        querySelector: () => null,
        createElement: (tag: string) => {
            assert.equal(tag, 'canvas');
            return fakeCanvas();
        },
    };
    (globalThis as any).Image = FakeImage;
    artwork = await import('../../src/client/utils/artwork');
});

test.beforeEach(() => {
    draws = [];
});

test(`${TAG} fewer than 4 items uses the first item's art`, async () => {
    const tracks = [track('a'), track('b'), track('c')];
    const src = await artwork.playlistCoverArt(tracks);
    assert.equal(src, artwork.renderTrackArt(tracks[0]));
    assert.equal(draws.length, 0);
});

test(`${TAG} empty playlist falls back to placeholder`, async () => {
    assert.equal(await artwork.playlistCoverArt([]), artwork.FALLBACK_ART_DATA_URI);
});

test(`${TAG} 4+ items render a 2x2 collage of the first 4 with centre crop`, async () => {
    const tracks = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => track(id));
    const src = await artwork.playlistCoverArt(tracks);
    assert.match(src, /^data:image\/jpeg;collage-/);
    assert.equal(draws.length, 4);
    assert.deepEqual(draws.map((d) => [d.dx, d.dy, d.dw, d.dh]), [
        [0, 0, 200, 200], [200, 0, 200, 200], [0, 200, 200, 200], [200, 200, 200, 200],
    ]);
    assert.ok(draws.every((d) => d.side === 200 && d.sx === 50 && d.sy === 0));
    assert.ok(!draws.some((d) => d.src.includes('p5')));
});

test(`${TAG} collages are cached by source set`, async () => {
    const tracks = ['c1', 'c2', 'c3', 'c4'].map((id) => track(id));
    const first = await artwork.playlistCoverArt(tracks);
    const drawsAfterFirst = draws.length;
    const second = await artwork.playlistCoverArt([...tracks, track('c5')]);
    assert.equal(second, first);
    assert.equal(draws.length, drawsAfterFirst);
});

test(`${TAG} images that fail to load are skipped`, async () => {
    const tracks = [track('ok1'), track('broken'), track('ok2'), track('ok3')];
    await artwork.playlistCoverArt(tracks);
    assert.equal(draws.length, 3);
});

test(`${TAG} applyPlaylistCover shows first art then swaps to collage`, async () => {
    const img = { src: '' } as HTMLImageElement;
    const tracks = ['a1', 'a2', 'a3', 'a4'].map((id) => track(id));
    artwork.applyPlaylistCover(img, tracks);
    assert.equal(img.src, artwork.renderTrackArt(tracks[0]));
    await artwork.playlistCoverArt(tracks);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(img.src, /^data:image\/jpeg;collage-/);
});

test(`${TAG} applyPlaylistCover ignores stale collage after src changes`, async () => {
    const img = { src: '' } as HTMLImageElement;
    const tracks = ['s1', 's2', 's3', 's4'].map((id) => track(id));
    artwork.applyPlaylistCover(img, tracks);
    img.src = 'other.jpg';
    await artwork.playlistCoverArt(tracks);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(img.src, 'other.jpg');
});

test(`${TAG} applyPlaylistCover keeps single cover for short lists`, async () => {
    const img = { src: '' } as HTMLImageElement;
    artwork.applyPlaylistCover(img, [track('x', false)]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(img.src, artwork.FALLBACK_ART_DATA_URI);
});
