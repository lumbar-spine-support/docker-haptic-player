import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIntifaceAddress, parseIntifaceAddress } from '../../src/client/utils/intifaceAddress';

const TAG = '[client:intifaceAddress]';

test(`${TAG} uses the selected scheme for a bare host`, () => {
    assert.deepEqual(parseIntifaceAddress('localhost:12345'), { scheme: 'ws://', host: 'localhost:12345' });
    assert.deepEqual(parseIntifaceAddress('example.com:443', 'wss://'), { scheme: 'wss://', host: 'example.com:443' });
});

test(`${TAG} a scheme typed into the host field wins over the selected one`, () => {
    assert.deepEqual(parseIntifaceAddress('WSS://example.com/', 'ws://'), { scheme: 'wss://', host: 'example.com/' });
    assert.deepEqual(parseIntifaceAddress('ws://10.0.0.2:12345', 'wss://'), { scheme: 'ws://', host: '10.0.0.2:12345' });
});

test(`${TAG} trims whitespace and leading slashes, and defaults an empty host`, () => {
    assert.deepEqual(parseIntifaceAddress('  //host:1  '), { scheme: 'ws://', host: 'host:1' });
    assert.deepEqual(parseIntifaceAddress('   ', 'wss://'), { scheme: 'wss://', host: 'localhost:12345' });
});

test(`${TAG} round-trips through formatIntifaceAddress`, () => {
    const url = formatIntifaceAddress({ scheme: 'wss://', host: 'example.com:443' });
    assert.equal(url, 'wss://example.com:443');
    assert.equal(formatIntifaceAddress(parseIntifaceAddress(url)), url);
});
