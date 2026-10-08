import test from 'node:test';
import assert from 'node:assert/strict';
import { createJellyfinTokenVerifier } from '../../src/server/services/jellyfinAuth';
import { tokenFromProtocols } from '../../src/server/index';

const TAG = '[server:jellyfin-auth]';
const BASE = 'https://jellyfin.example.com/';
const GOOD = '0123456789abcdef0123456789abcdef';

/** Fake Jellyfin: `/Users/Me` answers 200 for GOOD and 401 otherwise; counts calls. */
function fakeJellyfin(behaviour: 'normal' | 'down' = 'normal') {
    const calls: Array<{ url: string; authorization: string }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
        calls.push({ url, authorization: String(new Headers(init?.headers).get('Authorization')) });
        if (behaviour === 'down') throw new Error('ECONNREFUSED');
        return new Response(null, { status: init && String(new Headers(init.headers).get('Authorization')).includes(GOOD) ? 200 : 401 });
    }) as typeof fetch;
    return { calls, fetchFn };
}

test(`${TAG} accepts a token Jellyfin knows and asks /Users/Me with it`, async () => {
    const { calls, fetchFn } = fakeJellyfin();
    const verify = createJellyfinTokenVerifier(BASE, fetchFn);
    assert.equal(await verify(GOOD), true);
    assert.equal(calls[0].url, 'https://jellyfin.example.com/Users/Me');
    assert.match(calls[0].authorization, new RegExp(`^MediaBrowser .*Token="${GOOD}"`));
});

test(`${TAG} rejects unknown, missing and malformed tokens`, async () => {
    const { calls, fetchFn } = fakeJellyfin();
    const verify = createJellyfinTokenVerifier(BASE, fetchFn);
    assert.equal(await verify('ffffffffffffffffffffffffffffffff'), false);
    assert.equal(await verify(undefined), false);
    assert.equal(await verify('"injected" Token="x'), false);
    assert.equal(calls.length, 1, 'malformed and missing tokens never reach Jellyfin');
});

test(`${TAG} caches verdicts so reconnects do not hit Jellyfin every time`, async () => {
    const { calls, fetchFn } = fakeJellyfin();
    const verify = createJellyfinTokenVerifier(BASE, fetchFn);
    await verify(GOOD);
    await verify(GOOD);
    await verify('ffffffffffffffffffffffffffffffff');
    await verify('ffffffffffffffffffffffffffffffff');
    assert.equal(calls.length, 2);
});

test(`${TAG} an unreachable Jellyfin rejects without caching`, async () => {
    const { calls, fetchFn } = fakeJellyfin('down');
    const verify = createJellyfinTokenVerifier(BASE, fetchFn);
    assert.equal(await verify(GOOD), false);
    assert.equal(await verify(GOOD), false);
    assert.equal(calls.length, 2);
});

test(`${TAG} without a configured Jellyfin nothing is accepted`, async () => {
    const { calls, fetchFn } = fakeJellyfin();
    assert.equal(await createJellyfinTokenVerifier('', fetchFn)(GOOD), false);
    assert.equal(calls.length, 0);
});

test(`${TAG} the token is read from the offered WebSocket subprotocols`, () => {
    assert.equal(tokenFromProtocols(`happy, jellyfin.${GOOD}`), GOOD);
    assert.equal(tokenFromProtocols(['happy', `jellyfin.${GOOD}`]), GOOD);
    assert.equal(tokenFromProtocols('happy'), undefined);
    assert.equal(tokenFromProtocols(undefined), undefined);
});
