import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue, shuffled } from '../../src/client/components/player/queue';

const TAG = '[client:queue]';
const ALBUM = { type: 'album', id: 'a' } as const;

function loaded(ids: string[], start = 0): PlaybackQueue {
    const queue = new PlaybackQueue();
    queue.replace(ids, start, ALBUM);
    return queue;
}

const upcomingIds = (queue: PlaybackQueue) => queue.upcoming.map((entry) => entry.trackId);

test(`${TAG} a track queued twice gets two entries that can be told apart`, () => {
    const queue = loaded(['t1', 't2', 't1'], 2);
    assert.equal(queue.currentIndex, 2);
    assert.equal(queue.currentId, 't1');
    const [first, , last] = queue.entries;
    assert.notEqual(first.uid, last.uid);

    queue.jumpTo(first.uid);
    assert.equal(queue.currentIndex, 0);
});

test(`${TAG} replacing starts clean and is not counted as an edit`, () => {
    const queue = loaded(['t1', 't2']);
    queue.append(['t3']);
    assert.equal(queue.edited, true);
    queue.replace(['t4'], 0, { type: 'single' });
    assert.equal(queue.edited, false);
    assert.deepEqual(queue.trackIds, ['t4']);
});

test(`${TAG} play next goes right after the current entry, add to queue at the end`, () => {
    const queue = loaded(['t1', 't2', 't3']);
    queue.insertNext(['n1', 'n2']);
    queue.append(['e1']);
    assert.deepEqual(queue.trackIds, ['t1', 'n1', 'n2', 't2', 't3', 'e1']);
    assert.equal(queue.currentId, 't1');
});

test(`${TAG} tracks added before anything played wait as up next`, () => {
    const queue = new PlaybackQueue();
    queue.append(['t1', 't2']);
    assert.equal(queue.currentId, null);
    assert.deepEqual(upcomingIds(queue), ['t1', 't2']);
    assert.equal(queue.hasNext, true);
    assert.equal(queue.step(1), 't1');
});

test(`${TAG} playing a single track now keeps the rest of the queue`, () => {
    const queue = loaded(['t1', 't2', 't3']);
    queue.playNow('x');
    assert.deepEqual(queue.trackIds, ['t1', 'x', 't2', 't3']);
    assert.equal(queue.currentId, 'x');
});

test(`${TAG} playing an upcoming track now jumps to it instead of adding it again`, () => {
    const queue = loaded(['t1', 't2', 't3']);
    queue.playNow('t3');
    assert.deepEqual(queue.trackIds, ['t1', 't2', 't3']);
    assert.equal(queue.currentIndex, 2);
});

test(`${TAG} moving reorders only what is still to come`, () => {
    const queue = loaded(['t1', 't2', 't3', 't4'], 1);
    queue.moveUpcoming(1, 0);
    assert.deepEqual(queue.trackIds, ['t1', 't2', 't4', 't3']);
    queue.moveUpcoming(0, 5);
    assert.deepEqual(queue.trackIds, ['t1', 't2', 't4', 't3']);
});

test(`${TAG} only upcoming entries can be removed`, () => {
    const queue = loaded(['t1', 't2', 't3'], 1);
    queue.remove(queue.entries[0].uid);
    queue.remove(queue.entries[1].uid);
    assert.deepEqual(queue.trackIds, ['t1', 't2', 't3']);
    queue.remove(queue.entries[2].uid);
    assert.deepEqual(queue.trackIds, ['t1', 't2']);
});

test(`${TAG} shuffling leaves history and the current entry in place`, () => {
    const queue = loaded(['t1', 't2', 't3', 't4', 't5'], 1);
    queue.shuffleUpcoming(() => 0);
    assert.deepEqual(queue.trackIds.slice(0, 2), ['t1', 't2']);
    assert.deepEqual([...upcomingIds(queue)].sort(), ['t3', 't4', 't5']);
    assert.notDeepEqual(upcomingIds(queue), ['t3', 't4', 't5']);
    assert.equal(queue.edited, true);
});

test(`${TAG} clearing drops only what is still to come`, () => {
    const queue = loaded(['t1', 't2', 't3'], 1);
    queue.clearUpcoming();
    assert.deepEqual(queue.trackIds, ['t1', 't2']);
    assert.equal(queue.hasNext, false);
});

test(`${TAG} saving points the queue at the playlist and clears the edit flag`, () => {
    const queue = loaded(['t1']);
    queue.append(['t2']);
    queue.markSaved({ type: 'playlist', id: 'p' });
    assert.deepEqual(queue.source, { type: 'playlist', id: 'p' });
    assert.equal(queue.edited, false);
});

test(`${TAG} every change is announced`, () => {
    const queue = loaded(['t1', 't2', 't3']);
    let calls = 0;
    queue.onChange(() => calls++);
    queue.step(1);
    queue.append(['t4']);
    queue.moveUpcoming(0, 1);
    queue.clearUpcoming();
    assert.equal(calls, 4);
});

test(`${TAG} shuffled keeps every item exactly once`, () => {
    const items = ['a', 'b', 'c', 'd', 'a'];
    assert.deepEqual(shuffled(items).sort(), [...items].sort());
    assert.deepEqual(items, ['a', 'b', 'c', 'd', 'a']);
});
