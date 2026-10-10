import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue } from '../../src/client/components/player/queue';
import { publishQueue } from '../../src/client/components/player/queueTarget';
import { getQueueTarget, setQueueTarget, subscribeQueue, upcomingOf } from '@/components/videojs/features/queue';

const TAG = '[client:queueTarget]';

const library = {
    getTrack: (id: string) => (id === 'gone' ? undefined : { id, title: `Title ${id}`, artist: id === 't2' ? '' : 'Artist', filename: `${id}.mp4` }),
    getAlbum: (id: string) => (id === 'a1' ? { id, title: 'Album One' } : undefined),
    getPlaylist: (id: string) => (id === 'p1' ? { id, name: 'Mix' } : undefined),
} as any;

function setup() {
    const queue = new PlaybackQueue();
    const calls: string[] = [];
    const controller = {
        jumpTo: (uid: number) => calls.push(`jump ${uid}`),
        moveUpcoming: (from: number, to: number) => calls.push(`move ${from}->${to}`),
        removeFromQueue: (uid: number) => calls.push(`remove ${uid}`),
        shuffleUpcoming: () => calls.push('shuffle'),
        clearUpcoming: () => calls.push('clear'),
    } as any;
    const target = publishQueue(queue, controller, library, async (request) => {
        calls.push(`save ${request.mode}`);
        return 'saved';
    });
    return { queue, target, calls };
}

test.afterEach(() => setQueueTarget(null));

test(`${TAG} publishes a state the panel can render without the library`, () => {
    const { queue, target } = setup();
    assert.equal(getQueueTarget(), target);
    queue.replace(['t1', 't2', 'gone'], 1, { type: 'album', id: 'a1' });

    const state = target.getState();
    assert.equal(state.currentIndex, 1);
    assert.equal(state.sourceName, 'Album One');
    assert.equal(state.fromPlaylist, false);
    assert.equal(state.edited, false);
    assert.deepEqual(state.items.map((item) => [item.title, item.subtitle]), [
        ['Title t1', 'Artist'],
        ['Title t2', 't2.mp4'],
        ['Unknown', ''],
    ]);
    assert.deepEqual(upcomingOf(state).map((item) => item.trackId), ['gone']);
});

test(`${TAG} a queue from a playlist can be written back once edited`, async () => {
    const { queue, target, calls } = setup();
    queue.replace(['t1', 't2'], 0, { type: 'playlist', id: 'p1' });
    assert.equal(target.getState().fromPlaylist, true);
    assert.equal(target.getState().sourceName, 'Mix');
    queue.append(['t3']);
    assert.equal(target.getState().edited, true);
    assert.equal(await target.save({ mode: 'overwrite' }), 'saved');
    assert.deepEqual(calls, ['save overwrite']);
});

test(`${TAG} every change goes through the controller`, () => {
    const { target, calls } = setup();
    void target.jumpTo(4);
    target.moveUpcoming(0, 2);
    target.remove(5);
    target.shuffle();
    target.clear();
    assert.deepEqual(calls, ['jump 4', 'move 0->2', 'remove 5', 'shuffle', 'clear']);
});

test(`${TAG} queue changes reach the player UI`, () => {
    const { queue } = setup();
    let notified = 0;
    const unsubscribe = subscribeQueue(() => notified++);
    queue.append(['t1']);
    unsubscribe();
    assert.equal(notified, 1);
});
