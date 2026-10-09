import test from 'node:test';
import assert from 'node:assert/strict';
import { jellyfinUrlFromPage } from '../../src/client/jellyfin/serverUrl';
import { relayEndpoint, relayPairingUrl } from '../../src/client/components/haptic/dglab/coyoteBackend';

test('Jellyfin address: derived from a page the plugin serves', () => {
    assert.equal(jellyfinUrlFromPage('https://jf.example.com/Happy/Web/'), 'https://jf.example.com');
    assert.equal(jellyfinUrlFromPage('https://jf.example.com/Happy/Web/?view=player&id=abc'), 'https://jf.example.com');
    assert.equal(jellyfinUrlFromPage('http://10.0.0.2:8096/happy/web'), 'http://10.0.0.2:8096');
    // Jellyfin's base URL setting puts everything under a prefix.
    assert.equal(jellyfinUrlFromPage('https://example.com/jellyfin/Happy/Web/'), 'https://example.com/jellyfin');
});

test('Jellyfin address: not derived from other pages', () => {
    assert.equal(jellyfinUrlFromPage('http://localhost:3000/'), null);
    assert.equal(jellyfinUrlFromPage('http://localhost:3000/?view=docs&id=happy-web'), null);
    assert.equal(jellyfinUrlFromPage('https://example.com/Happy/Website/'), null);
});

const page = { protocol: 'https:', host: 'happy.example.com' };

test('relay endpoint: same origin when nothing is configured', () => {
    assert.equal(relayEndpoint('', page).toString(), 'wss://happy.example.com/ws/dglab');
    assert.equal(relayEndpoint('', { protocol: 'http:', host: 'localhost:3000' }).toString(), 'ws://localhost:3000/ws/dglab');
});

test('relay endpoint: configured address in any common spelling', () => {
    assert.equal(relayEndpoint('wss://relay.example.com', page).toString(), 'wss://relay.example.com/ws/dglab');
    assert.equal(relayEndpoint('https://relay.example.com/', page).toString(), 'wss://relay.example.com/ws/dglab');
    assert.equal(relayEndpoint('http://192.168.1.10:8070', page).toString(), 'ws://192.168.1.10:8070/ws/dglab');
    // A bare host takes the page's scheme.
    assert.equal(relayEndpoint('relay.lan:8070', { protocol: 'http:', host: 'x' }).toString(), 'ws://relay.lan:8070/ws/dglab');
    // Behind a reverse proxy under a path prefix.
    assert.equal(relayEndpoint('https://example.com/dglab/', page).toString(), 'wss://example.com/dglab/ws/dglab');
});

test('relay endpoint: an invalid address falls back to the page origin', () => {
    assert.equal(relayEndpoint('https://', page).toString(), 'wss://happy.example.com/ws/dglab');
});

test('relay pairing URL: the phone dials the same endpoint by its own host', () => {
    const endpoint = relayEndpoint('wss://localhost:8070', page);
    assert.equal(relayPairingUrl(endpoint, '192.168.1.10:8070', 'abc-123'), 'wss://192.168.1.10:8070/ws/dglab?tid=abc-123');
    const proxied = relayEndpoint('https://example.com/dglab', page);
    assert.equal(relayPairingUrl(proxied, 'example.com', 't'), 'wss://example.com/dglab/ws/dglab?tid=t');
});
