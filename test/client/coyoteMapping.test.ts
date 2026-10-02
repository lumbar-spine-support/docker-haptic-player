import test from 'node:test';
import assert from 'node:assert/strict';

import { DglabSocketDeviceType, V4Channel } from 'dglab-kit';
import type { Device } from '../../src/client/components/haptic/dglab/v4/socket';
import { channelAlerts, channelCeiling, isChannelMuted, isLoopbackHost, mapIntensity, normalizeHost } from '../../src/client/components/haptic/dglab/coyoteBackend';

const TAG = '[client:dglab:mapping]';

function device(intensityMax: number | undefined, comfortMax?: number, isMuted = false): Device {
    return {
        slotId: 'U2j452hg',
        name: 'COYOTE',
        type: DglabSocketDeviceType.COYOTE_030,
        slotState: { channelA: { intensityMax, isMuted, comfortLimit: { comfortMax } } },
    };
}

/** The exact payload the DG-Lab 4 app answers `devices.get` with. */
const REAL_DEVICE: Device = {
    id: 0,
    slotId: 'U2j452hg',
    name: 'COYOTE',
    type: DglabSocketDeviceType.COYOTE_030,
    props: { power: 0, connectState: 'connected', channelAStatus: 0, channelBStatus: 0 },
    slotState: {
        hasDevice: true,
        channelA: { comfortLimit: { comfortMax: 24, absoluteMax: 25 }, intensityMax: 25, isMuted: true },
        channelB: { comfortLimit: { comfortMax: 23, absoluteMax: 25 }, intensityMax: 25, isMuted: true },
    },
};

test(`${TAG} the ceiling is the app's computed intensityMax, not the comfort input`, () => {
    const parsed = REAL_DEVICE;
    assert.equal(channelCeiling(parsed, V4Channel.A), 25);
    assert.equal(channelCeiling(parsed, V4Channel.B), 25);
    // Raising the limit in the app must actually raise the ceiling here.
    assert.equal(channelCeiling(device(42, 17), V4Channel.A), 42);
});

test(`${TAG} a channel muted in the app is reported as muted`, () => {
    const parsed = REAL_DEVICE;
    assert.equal(isChannelMuted(parsed, V4Channel.A), true);
    assert.equal(isChannelMuted(device(25, 24, false), V4Channel.A), false);
});

test(`${TAG} position scales linearly into the app's configured ceiling`, () => {
    assert.equal(mapIntensity(0, 1, 20), 0);
    assert.equal(mapIntensity(0.5, 1, 20), 10);
    assert.equal(mapIntensity(1, 1, 20), 20);
});

test(`${TAG} master and device strength multiply on top of the position`, () => {
    assert.equal(mapIntensity(1, 0.5, 20), 10);
    assert.equal(mapIntensity(0.5, 0.5, 20), 5);
});

test(`${TAG} out-of-range inputs can never exceed the ceiling`, () => {
    assert.equal(mapIntensity(5, 1, 20), 20);
    assert.equal(mapIntensity(1, 5, 20), 20);
    assert.equal(mapIntensity(-1, 1, 20), 0);
});

test(`${TAG} a missing ceiling means no output at all, never a guessed default`, () => {
    assert.equal(channelCeiling(device(undefined), V4Channel.A), 0);
    assert.equal(mapIntensity(1, 1, channelCeiling(device(undefined), V4Channel.A)), 0);
});

test(`${TAG} the ceiling is read from the slot state the DG-Lab app reports`, () => {
    assert.equal(channelCeiling(device(12), V4Channel.A), 12);
    // Channel B has no state in the fixture, so it must not inherit channel A's cap.
    assert.equal(channelCeiling(device(12), V4Channel.B), 0);
});

test(`${TAG} a slot without hardware is a danger alert, even though the app is paired`, () => {
    const unplugged: Device = { ...REAL_DEVICE, slotState: { ...REAL_DEVICE.slotState, hasDevice: false } };
    assert.deepEqual(channelAlerts(unplugged, V4Channel.A), [{ level: 'danger', message: 'Device not connected to DG-Lab' }]);
});

test(`${TAG} channel faults reported by the device are danger alerts`, () => {
    for (const [status, reason] of [[1, 'no electrode circuit'], [3, 'damaged'], [4, 'masked']] as const) {
        const faulty: Device = { ...REAL_DEVICE, props: { ...REAL_DEVICE.props, channelBStatus: status } };
        assert.deepEqual(channelAlerts(faulty, V4Channel.B), [{ level: 'danger', message: `Channel B: ${reason}` }]);
    }
});

test(`${TAG} muted channels and a missing ceiling are warnings, a healthy channel has none`, () => {
    assert.deepEqual(channelAlerts(device(25, 24, true), V4Channel.A), [{ level: 'warning', message: 'Channel A muted in DG-Lab' }]);
    assert.deepEqual(channelAlerts(device(undefined), V4Channel.A), [
        { level: 'warning', message: 'Channel A has no strength limit set in DG-Lab' },
    ]);
    assert.deepEqual(channelAlerts(device(25, 24, false), V4Channel.A), []);
});
test(`${TAG} a pairing host is reduced to bare host and port`, () => {
    assert.equal(normalizeHost(' ws://192.168.1.10:3000/ws/dglab '), '192.168.1.10:3000');
    assert.equal(normalizeHost('http://happy.lan/'), 'happy.lan');
    assert.equal(normalizeHost('192.168.1.10:3000'), '192.168.1.10:3000');
});

test(`${TAG} loopback hosts are recognised so the UI can warn about them`, () => {
    for (const host of ['localhost:3000', 'LOCALHOST', '127.0.0.1:3000', '[::1]:3000']) {
        assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of ['192.168.1.10:3000', 'happy.lan']) {
        assert.equal(isLoopbackHost(host), false, host);
    }
});
