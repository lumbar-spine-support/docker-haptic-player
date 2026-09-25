import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ActionType,
    Channel,
    buildAppendPulseData,
    buildClear,
    buildDevicesGet,
    buildResetIntensity,
    buildSetTempIntensity,
    eventName,
    eventPayload,
    mergeSlotState,
    pairingDeepLink,
    parseDeviceList,
} from '../../src/client/components/haptic/dglab/protocol';
import { carrierFrames, clampFrequency, flatFrame } from '../../src/client/components/haptic/dglab/waveform';

const TAG = '[client:dglab:protocol]';

function opData(message: ReturnType<typeof buildSetTempIntensity>): Record<string, unknown> {
    assert.equal(message.t, 'req');
    return (message as { data: Record<string, unknown> }).data;
}

test(`${TAG} devices.get is a plain request with no payload`, () => {
    assert.deepEqual(buildDevicesGet('r1'), { t: 'req', reqId: 'r1', m: 'devices.get' });
});

test(`${TAG} strength is sent as SetTempIntensity with im:true`, () => {
    const data = opData(buildSetTempIntensity('r2', 'slot-1', Channel.B, 7.4, 300));
    assert.equal(data.s, 'slot-1');
    assert.equal(data.t, ActionType.SetTempIntensity);
    assert.equal(data.c, Channel.B);
    assert.equal(data.v, 7);
    assert.equal(data.d, 300);
    // Absolute values only work if the previous task is replaced rather than stacked.
    assert.equal(data.im, true);
});

test(`${TAG} every operation uses a priority the schema accepts`, () => {
    const operations = [
        buildSetTempIntensity('r', 's', Channel.A, 1, 300),
        buildAppendPulseData('r', 's', Channel.A, ['0A0A0A0A64646464'], 1000, 1),
        buildResetIntensity('r', 's', Channel.A),
    ];
    // Anything outside 0|1|2 is rejected wholesale as invalid_operate.
    for (const op of operations) assert.ok([0, 1, 2].includes(opData(op).p as number));
});

test(`${TAG} strength never goes negative and is always an integer`, () => {
    assert.equal(opData(buildSetTempIntensity('r', 's', Channel.A, -5, 300)).v, 0);
    assert.equal(opData(buildSetTempIntensity('r', 's', Channel.A, 3.6, 300)).v, 4);
});

test(`${TAG} pulse data carries the frame list, version and sequence`, () => {
    const data = opData(buildAppendPulseData('r3', 'slot-1', Channel.A, ['0A0A0A0A64646464'], 1000, 12));
    assert.equal(data.t, ActionType.AppendPulseData);
    assert.deepEqual(data.v, ['0A0A0A0A64646464']);
    assert.equal(data.ver, 3);
    assert.equal(data.seq, 12);
    assert.equal(data.d, 1000);
    // Without this the queue grows unboundedly and the device plays stale frames.
    assert.equal(data.im, true);
});

test(`${TAG} reset uses SetIntensity, which only accepts zero`, () => {
    const data = opData(buildResetIntensity('r4', 'slot-1', Channel.A));
    assert.equal(data.t, ActionType.SetIntensity);
    assert.equal(data.v, 0);
    assert.equal('im' in data, false);
});

test(`${TAG} clear targets the whole slot`, () => {
    assert.deepEqual(buildClear('r5', 'slot-1'), { t: 'req', reqId: 'r5', m: 'device.op.clear', data: { s: 'slot-1' } });
});

test(`${TAG} event name reads the ev field the app actually sends`, () => {
    assert.equal(eventName({ t: 'ev', ev: 'devices.snapshot' }), 'devices.snapshot');
    assert.equal(eventName({ t: 'ev', m: 'devices.patch' }), 'devices.patch');
    assert.equal(eventName({ t: 'ev', e: 'slots.patch' }), 'slots.patch');
    assert.equal(eventName({ t: 'ev' }), '');
});

test(`${TAG} an event payload sitting inline on the envelope is used as-is`, () => {
    const inline = { t: 'ev', ev: 'devices.snapshot', devices: [{ id: 'slot-1', type: 'COYOTE_030' }] } as const;
    assert.equal(eventPayload(inline), inline);
    const nested = { t: 'ev', ev: 'devices.snapshot', data: { devices: [] } } as const;
    assert.deepEqual(eventPayload(nested), { devices: [] });
});

test(`${TAG} a snapshot event is parsed straight off the envelope`, () => {
    const event = { t: 'ev', ev: 'devices.snapshot', devices: [{ id: 'slot-1', type: 'COYOTE_030' }] } as const;
    assert.deepEqual(parseDeviceList(eventPayload(event)).map((d) => d.id), ['slot-1']);
});

test(`${TAG} device lists are accepted as a bare array or wrapped in devices`, () => {
    const entry = { id: 'slot-1', type: 'COYOTE_030' };
    assert.deepEqual(parseDeviceList([entry]).map((d) => d.id), ['slot-1']);
    assert.deepEqual(parseDeviceList({ devices: [entry] }).map((d) => d.id), ['slot-1']);
    assert.deepEqual(parseDeviceList(null), []);
    assert.deepEqual(parseDeviceList([{ type: 'COYOTE_030' }]), []);
});

test(`${TAG} a slot id is accepted under any of its wire spellings, including numeric`, () => {
    for (const entry of [{ id: 'a' }, { s: 'a' }, { slotId: 'a' }, { slot: 'a' }, { deviceId: 'a' }]) {
        assert.equal(parseDeviceList([entry])[0]?.id, 'a', JSON.stringify(entry));
    }
    assert.equal(parseDeviceList([{ id: 3 }])[0]?.id, '3');
});

test(`${TAG} a slots patch merges one level into each channel instead of replacing it`, () => {
    const merged = mergeSlotState(
        { channelA: { isMuted: false, intensityMax: 20 }, channelB: { intensityMax: 5 } },
        { channelA: { intensityMax: 12 } },
    );
    assert.deepEqual(merged.channelA, { isMuted: false, intensityMax: 12 });
    assert.deepEqual(merged.channelB, { intensityMax: 5 });
});

test(`${TAG} a patch to a nested comfort limit keeps the fields it omits`, () => {
    // A shallow merge would drop comfortMax here and raise the safety ceiling.
    const merged = mergeSlotState(
        { channelA: { intensityMax: 25, comfortLimit: { comfortMax: 17, absoluteMax: 25 } } },
        { channelA: { intensityMax: 42, comfortLimit: { absoluteMax: 42 } } },
    );
    assert.deepEqual(merged.channelA, {
        intensityMax: 42,
        comfortLimit: { comfortMax: 17, absoluteMax: 42 },
    });
});

test(`${TAG} a slots patch on an unknown channel is added, not dropped`, () => {
    assert.deepEqual(mergeSlotState(undefined, { channelA: { intensityMax: 3 } }).channelA, { intensityMax: 3 });
});

test(`${TAG} the pairing deep link url-encodes the relay address`, () => {
    const link = pairingDeepLink('ws://192.168.1.5:3000/ws/dglab?tid=abc');
    assert.equal(link, 'https://dungeon-lab.cn/s/?v=1&action=socket&url=ws%3A%2F%2F192.168.1.5%3A3000%2Fws%2Fdglab%3Ftid%3Dabc');
});

test(`${TAG} a carrier frame is four frequency bytes then four amplitude bytes`, () => {
    assert.equal(flatFrame(10), '0A0A0A0A64646464');
    assert.equal(flatFrame(1, 0), '0101010100000000');
});

test(`${TAG} frequency is clamped into the device's usable range`, () => {
    assert.equal(clampFrequency(0), 1);
    assert.equal(clampFrequency(500), 100);
    assert.equal(clampFrequency(Number.NaN), 10);
    assert.equal(flatFrame(500), '6464646464646464');
});

test(`${TAG} the carrier repeats one identical frame`, () => {
    const frames = carrierFrames(10, 3);
    assert.equal(frames.length, 3);
    assert.deepEqual(new Set(frames), new Set(['0A0A0A0A64646464']));
});
