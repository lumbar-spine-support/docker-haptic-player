import test from 'node:test';
import assert from 'node:assert/strict';
import { getLogLevel, setLogLevel } from '../../src/client/utils/logger';

const TAG = '[client:logger]';

test(`${TAG} children inherit the closest configured namespace`, () => {
    setLogLevel('*', 'warn');
    setLogLevel('dglab', 'debug');
    setLogLevel('dglab:socket', 'error');
    assert.equal(getLogLevel('dglab'), 'debug');
    assert.equal(getLogLevel('dglab:pairing'), 'debug');
    assert.equal(getLogLevel('dglab:socket'), 'error');
    assert.equal(getLogLevel('player'), 'warn');
});
