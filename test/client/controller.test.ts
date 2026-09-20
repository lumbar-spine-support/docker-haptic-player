import test from 'node:test';
import assert from 'node:assert/strict';
import type { AlbumInfo, PlaylistInfo, TrackInfo } from '../../src/shared/types';
import { PlaybackQueue } from '../../src/client/components/player/queue';
import { setRepeatMode } from '@/components/videojs/features/repeat';

const TAG = '[client:controller]';

// `utils/api` reads `window.location` at module-load time and the skip provider
// touches no DOM, so a minimal global stub is enough to import the controller.
let PlaybackController: typeof import('../../src/client/components/player/controller').PlaybackController;

test.before(async () => {
    (globalThis as any).window = { location: { href: 'http://localhost/' } };
    (globalThis as any).document = { querySelector: () => null };
    ({ PlaybackController } = await import('../../src/client/components/player/controller'));
});

// The repeat mode is process-wide, so every test starts from a known state.
test.beforeEach(() => setRepeatMode('off'));

function track(id: string): TrackInfo {
    return { id, type: 'audio', title: id, artist: 'artist', filename: `${id}.mp3`, hasArtwork: false } as TrackInfo;
}

const ALBUM: AlbumInfo = { id: 'album-1', title: 'Album', trackIds: ['t1', 't2', 't3'] } as AlbumInfo;
const PLAYLIST: PlaylistInfo = {
    id: 'playlist-1',
    name: 'Playlist',
    entries: [{ trackId: 't1' }, { trackId: 't3' }],
} as PlaylistInfo;

/** Only the members `PlaybackController` actually reads. */
function makeLibrary() {
    return {
        getTrack: (id: string) => (['t1', 't2', 't3'].includes(id) ? track(id) : undefined),
        getAlbum: (id: string) => (id === ALBUM.id ? ALBUM : undefined),
        getPlaylist: (id: string) => (id === PLAYLIST.id ? PLAYLIST : undefined),
        findAlbumForTrack: () => ALBUM,
        findPlaylistForTrack: () => PLAYLIST,
    } as any;
}

function makeSession() {
    const listeners: Array<() => void> = [];
    return {
        activeTrackId: null as string | null,
        activeStore: { state: { ended: false } },
        loop: false,
        onChange(listener: () => void) { listeners.push(listener); },
        browse() { },
        start: async () => { },
        setLoop(value: boolean) { this.loop = value; },
        emit() { for (const listener of listeners) listener(); },
        /** Pretends the active media reached its end and notifies the controller. */
        async end() {
            this.activeStore.state.ended = true;
            this.emit();
            this.activeStore.state.ended = false;
            await Promise.resolve();
        },
    } as any;
}

function setup() {
    const queue = new PlaybackQueue();
    const session = makeSession();
    const controller = new PlaybackController(makeLibrary(), queue, session);
    return { queue, controller, session };
}

test(`${TAG} playing a track opened on its own gives a single-entry queue`, async () => {
    const { queue, controller } = setup();
    await controller.activate('t1');
    assert.deepEqual(controller.canStep, { prev: false, next: false });
    assert.equal(queue.currentId, 't1');
    assert.deepEqual(queue.source, { type: 'single' });
});

test(`${TAG} a track belonging to an album gains no neighbours when opened directly`, async () => {
    const { controller } = setup();
    // The stub library reports an album *and* a playlist for every track; the
    // controller must ignore both unless the track was opened from one.
    await controller.activate('t2');
    assert.deepEqual(controller.canStep, { prev: false, next: false });
});

test(`${TAG} starting from an album queues that album`, async () => {
    const { queue, controller } = setup();
    await controller.activate('t1', { type: 'album', id: ALBUM.id });
    assert.deepEqual(controller.canStep, { prev: false, next: true });
    assert.deepEqual(queue.source, { type: 'album', id: ALBUM.id });

    await controller.step(1);
    assert.equal(queue.currentId, 't2');
    assert.deepEqual(controller.canStep, { prev: true, next: true });

    await controller.step(1);
    assert.equal(queue.currentId, 't3');
    assert.deepEqual(controller.canStep, { prev: true, next: false });
});

test(`${TAG} starting from a playlist queues that playlist, not the album`, async () => {
    const { queue, controller } = setup();
    await controller.activate('t1', { type: 'playlist', id: PLAYLIST.id });
    assert.deepEqual(queue.source, { type: 'playlist', id: PLAYLIST.id });

    // The playlist skips t2, so one step forward must land on t3.
    await controller.step(1);
    assert.equal(queue.currentId, 't3');
    assert.deepEqual(controller.canStep, { prev: true, next: false });
});

test(`${TAG} stepping keeps the queue's own source`, async () => {
    const { queue, controller } = setup();
    await controller.activate('t1', { type: 'album', id: ALBUM.id });
    await controller.step(1);
    assert.deepEqual(queue.source, { type: 'album', id: ALBUM.id });
});

/** Lets the `void`-ed end-of-track handling run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test(`${TAG} repeat off stops at the end of the queue`, async () => {
    const { queue, controller, session } = setup();
    await controller.activate('t3', { type: 'album', id: ALBUM.id });

    await session.end();
    await settle();
    assert.equal(queue.currentId, 't3');
});

test(`${TAG} repeat queue wraps back to the first track`, async () => {
    const { queue, controller, session } = setup();
    await controller.activate('t3', { type: 'album', id: ALBUM.id });
    setRepeatMode('queue');

    await session.end();
    await settle();
    assert.equal(queue.currentId, 't1');
    assert.deepEqual(queue.source, { type: 'album', id: ALBUM.id });
});

test(`${TAG} the end of a track still advances the queue while repeating it`, async () => {
    const { queue, controller, session } = setup();
    await controller.activate('t1', { type: 'album', id: ALBUM.id });
    setRepeatMode('queue');

    await session.end();
    await settle();
    assert.equal(queue.currentId, 't2');
});

test(`${TAG} repeat current is handed to the players as native looping`, async () => {
    const { session } = setup();
    setRepeatMode('one');
    assert.equal(session.loop, true);

    setRepeatMode('off');
    assert.equal(session.loop, false);
});

test(`${TAG} loading the next track does not advance the queue a second time`, async () => {
    const { queue, controller, session } = setup();
    await controller.activate('t1', { type: 'album', id: ALBUM.id });

    // Loading a track notifies listeners while the old media still reports
    // `ended`, which used to re-enter the end-of-track handling and skip twice.
    session.start = async () => { session.emit(); };

    await session.end();
    await settle();
    assert.equal(queue.currentId, 't2');
});
