import test from 'node:test';
import assert from 'node:assert/strict';

import { lanAddresses } from '../../../src/server/utils/network';

const TAG = '[server:utils:network]';

test(`${TAG} reports only routable IPv4 addresses`, () => {
    for (const address of lanAddresses()) {
        assert.match(address, /^\d+\.\d+\.\d+\.\d+$/);
        assert.doesNotMatch(address, /^127\./);
        // Link-local addresses mean DHCP failed and are never reachable.
        assert.doesNotMatch(address, /^169\.254\./);
    }
});

test(`${TAG} prefers home LAN ranges over Docker's bridge`, () => {
    const ranked = lanAddresses();
    const docker = ranked.findIndex((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a));
    const home = ranked.findIndex((a) => a.startsWith('192.168.') || a.startsWith('10.'));
    // A container's bridge address is rarely reachable from the user's phone.
    if (docker !== -1 && home !== -1) assert.ok(home < docker);
});
