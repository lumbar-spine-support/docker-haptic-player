import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialsFromJellyfinWeb } from '../../src/client/jellyfin/connection';

const TAG = '[client:jellyfin-web-credentials]';
const SERVER = 'https://jf.example.com';

function credentials(...servers: object[]): string {
    return JSON.stringify({ Servers: servers });
}

test(`${TAG} takes the server entry whose address matches`, () => {
    const raw = credentials(
        { Id: 'a', ManualAddress: 'https://other.example.com', AccessToken: 'tokA', UserId: 'userA' },
        { Id: 'b', ManualAddress: 'https://JF.example.com/', AccessToken: 'tokB', UserId: 'userB' },
    );
    assert.deepEqual(credentialsFromJellyfinWeb(raw, SERVER), { token: 'tokB', userId: 'userB' });
});

test(`${TAG} also matches the local address`, () => {
    const raw = credentials(
        { AccessToken: 'tokA', UserId: 'userA' },
        { LocalAddress: SERVER, AccessToken: 'tokB', UserId: 'userB' },
    );
    assert.deepEqual(credentialsFromJellyfinWeb(raw, SERVER), { token: 'tokB', userId: 'userB' });
});

test(`${TAG} falls back to the first signed-in entry (same origin, same server)`, () => {
    const raw = credentials(
        { Id: 'x', ManualAddress: 'http://172.17.0.1:8096' },
        { Id: 'y', ManualAddress: 'http://172.17.0.1:8096', AccessToken: 'tok', UserId: 'user' },
    );
    assert.deepEqual(credentialsFromJellyfinWeb(raw, SERVER), { token: 'tok', userId: 'user' });
});

test(`${TAG} returns null when Jellyfin's web client is not signed in`, () => {
    assert.equal(credentialsFromJellyfinWeb(null, SERVER), null);
    assert.equal(credentialsFromJellyfinWeb('{}', SERVER), null);
    assert.equal(credentialsFromJellyfinWeb(credentials({ ManualAddress: SERVER, AccessToken: '', UserId: 'u' }), SERVER), null);
    assert.equal(credentialsFromJellyfinWeb(credentials({ ManualAddress: SERVER, AccessToken: 'tok' }), SERVER), null);
});

test(`${TAG} returns null for malformed storage`, () => {
    assert.equal(credentialsFromJellyfinWeb('not json', SERVER), null);
    assert.equal(credentialsFromJellyfinWeb('{"Servers":"nope"}', SERVER), null);
    assert.equal(credentialsFromJellyfinWeb('[null]', SERVER), null);
});
