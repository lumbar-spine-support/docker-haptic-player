import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canSkip,
    getSkipTarget,
    notifySkipChanged,
    setSkipTarget,
    stepFor,
    subscribeSkip,
    type SkipTarget,
} from '../../@/components/videojs/features/skip';
import { PlaybackQueue } from '../../src/client/components/player/queue';

const TAG = '[client:skip]';

function makeTarget(prev: boolean, next: boolean): SkipTarget & { steps: number[] } {
    return {
        canStep: { prev, next },
        steps: [] as number[],
        step(direction: -1 | 1) { this.steps.push(direction); },
    };
}

test.afterEach(() => { setSkipTarget(null); });

test(`${TAG} stepFor maps the direction attribute to a queue step`, () => {
    assert.equal(stepFor('backward'), -1);
    assert.equal(stepFor('forward'), 1);
    // Anything unset/unknown behaves as a forward skip.
    assert.equal(stepFor(null), 1);
    assert.equal(stepFor('sideways'), 1);
});

test(`${TAG} canSkip is false without a published target`, () => {
    assert.equal(canSkip(null, -1), false);
    assert.equal(canSkip(null, 1), false);
});

test(`${TAG} canSkip follows the target's prev/next availability`, () => {
    assert.equal(canSkip(makeTarget(true, false), -1), true);
    assert.equal(canSkip(makeTarget(true, false), 1), false);
    assert.equal(canSkip(makeTarget(false, true), -1), false);
    assert.equal(canSkip(makeTarget(false, true), 1), true);
});

test(`${TAG} setSkipTarget publishes the target and notifies subscribers`, () => {
    let calls = 0;
    const unsubscribe = subscribeSkip(() => { calls += 1; });
    const target = makeTarget(true, true);

    setSkipTarget(target);
    assert.equal(getSkipTarget(), target);
    assert.equal(calls, 1);

    // Re-publishing the same target must not churn the buttons.
    setSkipTarget(target);
    assert.equal(calls, 1);

    notifySkipChanged();
    assert.equal(calls, 2);

    unsubscribe();
    notifySkipChanged();
    assert.equal(calls, 2);
});

test(`${TAG} setSkipTarget(null) detaches the buttons`, () => {
    setSkipTarget(makeTarget(true, true));
    setSkipTarget(null);
    assert.equal(getSkipTarget(), null);
    assert.equal(canSkip(getSkipTarget(), 1), false);
});

test(`${TAG} a queue-backed target gates both directions at the edges`, () => {
    const queue = new PlaybackQueue();
    const target: SkipTarget = {
        get canStep() { return { prev: queue.hasPrev, next: queue.hasNext }; },
        step(direction) { queue.step(direction); },
    };
    queue.load(['a', 'b', 'c'], 'a', { type: 'album', id: 'album-1' });

    assert.equal(canSkip(target, -1), false, 'first track has no previous');
    assert.equal(canSkip(target, 1), true);

    target.step(1);
    assert.equal(queue.currentId, 'b');
    assert.equal(canSkip(target, -1), true);
    assert.equal(canSkip(target, 1), true);

    target.step(1);
    assert.equal(queue.currentId, 'c');
    assert.equal(canSkip(target, -1), true);
    assert.equal(canSkip(target, 1), false, 'last track has no next');

    target.step(-1);
    assert.equal(queue.currentId, 'b');
});

test(`${TAG} a single-track queue disables both directions`, () => {
    const queue = new PlaybackQueue();
    queue.load(['only'], 'only', { type: 'single' });
    const target: SkipTarget = {
        canStep: { prev: queue.hasPrev, next: queue.hasNext },
        step() { },
    };
    assert.equal(canSkip(target, -1), false);
    assert.equal(canSkip(target, 1), false);
});
