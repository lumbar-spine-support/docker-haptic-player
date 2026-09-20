import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cycleRepeatMode,
    getRepeatMode,
    nextRepeatMode,
    setRepeatMode,
    subscribeRepeat,
} from '../../@/components/videojs/features/repeat';

const TAG = '[client:repeat]';

test.beforeEach(() => setRepeatMode('off'));

test(`${TAG} the cycle walks off -> queue -> one -> off`, () => {
    assert.equal(nextRepeatMode('off'), 'queue');
    assert.equal(nextRepeatMode('queue'), 'one');
    assert.equal(nextRepeatMode('one'), 'off');
});

test(`${TAG} pressing the button advances and reports the new mode`, () => {
    assert.equal(getRepeatMode(), 'off');
    assert.equal(cycleRepeatMode(), 'queue');
    assert.equal(getRepeatMode(), 'queue');
    assert.equal(cycleRepeatMode(), 'one');
    assert.equal(cycleRepeatMode(), 'off');
});

test(`${TAG} subscribers are notified on every change`, () => {
    let calls = 0;
    const unsubscribe = subscribeRepeat(() => { calls += 1; });

    cycleRepeatMode();
    assert.equal(calls, 1);

    setRepeatMode('one');
    assert.equal(calls, 2);

    unsubscribe();
    cycleRepeatMode();
    assert.equal(calls, 2);
});

test(`${TAG} re-setting the same mode does not notify`, () => {
    setRepeatMode('queue');
    let calls = 0;
    const unsubscribe = subscribeRepeat(() => { calls += 1; });

    setRepeatMode('queue');
    assert.equal(calls, 0);

    unsubscribe();
});
