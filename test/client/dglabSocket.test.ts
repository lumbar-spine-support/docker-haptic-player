import test from 'node:test';
import assert from 'node:assert/strict';

import { DglabSocket, V4Channel } from 'dglab-kit';

import { pairingDeepLink } from '../../src/client/components/haptic/dglab/v4/pairing';
import { DglabV4Socket } from '../../src/client/components/haptic/dglab/v4/socket';
import {
    carrierFrames,
    clampFrequency,
    clampPulseWidth,
    flatFrame,
    pulsePeriodMs,
} from '../../src/client/components/haptic/dglab/waveform';

const TAG = '[client:dglab:socket]';

type Sent = { type: string; clientId?: string; data?: { t: string; reqId: string; m: string; data?: Record<string, unknown> } };

function snapshot(...slotIds: string[]) {
    return { t: 'ev', ev: 'devices.snapshot', devices: slotIds.map((slotId, id) => ({ id, slotId, name: 'COYOTE', type: 'COYOTE_030' })) };
}

/** A wrapper on the kit's manual transport, paired with one app owning `slot-1`. */
function setup() {
    const sent: Sent[] = [];
    const kit = new DglabSocket();
    kit.setSender((data) => sent.push(JSON.parse(String(data)) as Sent));
    const socket = new DglabV4Socket(() => kit);
    const recv = (frame: unknown) => kit.handleMessage(JSON.stringify(frame));
    socket.connect('ws://relay/ws/dglab');
    recv({ type: 'hello', clientId: 'ctl' });
    recv({ type: 'client_attached', clientId: 'app1' });
    recv({ type: 'message', clientId: 'app1', data: snapshot('slot-1') });
    sent.length = 0;
    return { socket, kit, sent, recv };
}

function lastOp(sent: Sent[]) {
    const frame = sent[sent.length - 1];
    assert.ok(frame, 'nothing was sent');
    assert.equal(frame.type, 'message');
    assert.equal(frame.data?.t, 'req');
    return frame;
}

test(`${TAG} hello exposes the relay id as the pairing target`, () => {
    const { socket } = setup();
    assert.equal(socket.connectionState, 'connected');
    assert.equal(socket.targetId, 'ctl');
    assert.equal(socket.appCount, 1);
    assert.deepEqual(socket.devices.map((d) => d.slotId), ['slot-1']);
    socket.disconnect();
});

test(`${TAG} attaching an app asks it for its devices`, () => {
    const sent: Sent[] = [];
    const kit = new DglabSocket();
    kit.setSender((data) => sent.push(JSON.parse(String(data)) as Sent));
    const socket = new DglabV4Socket(() => kit);
    socket.connect('ws://relay/ws/dglab');
    kit.handleMessage(JSON.stringify({ type: 'hello', clientId: 'ctl' }));
    kit.handleMessage(JSON.stringify({ type: 'client_attached', clientId: 'app1' }));
    assert.equal(sent[sent.length - 1]?.clientId, 'app1');
    assert.equal(sent[sent.length - 1]?.data?.m, 'devices.get');
    socket.disconnect();
});

test(`${TAG} strength is sent as SetTempIntensity with im:true and a valid priority`, () => {
    const { socket, sent } = setup();
    socket.setTempIntensity('slot-1', V4Channel.B, 7.4, 300);
    const frame = lastOp(sent);
    assert.equal(frame.clientId, 'app1');
    assert.equal(frame.data?.m, 'device.op');
    // Absolute values only work if the previous task is replaced rather than stacked.
    assert.deepEqual(frame.data?.data, { s: 'slot-1', c: 1, p: 1, im: true, t: 4, v: 7, d: 300 });
    socket.disconnect();
});

test(`${TAG} strength never goes negative and is always an integer`, () => {
    const { socket, sent } = setup();
    socket.setTempIntensity('slot-1', V4Channel.A, -5, 300);
    assert.equal(lastOp(sent).data?.data?.v, 0);
    socket.setTempIntensity('slot-1', V4Channel.A, 3.6, 300);
    assert.equal(lastOp(sent).data?.data?.v, 4);
    socket.disconnect();
});

test(`${TAG} pulse data carries the frame list, version and sequence with im:true`, () => {
    const { socket, sent } = setup();
    socket.appendPulse('slot-1', V4Channel.A, ['0A0A0A0A64646464'], 1000, 12);
    // Without im:true the queue grows unboundedly and the device plays stale frames.
    assert.deepEqual(lastOp(sent).data?.data, {
        s: 'slot-1', c: 0, p: 1, im: true, t: 0, d: 1000, v: ['0A0A0A0A64646464'], ver: 3, seq: 12,
    });
    socket.disconnect();
});

test(`${TAG} reset uses SetIntensity, which only accepts zero`, () => {
    const { socket, sent } = setup();
    socket.resetIntensity('slot-1', V4Channel.A);
    assert.deepEqual(lastOp(sent).data?.data, { s: 'slot-1', c: 0, p: 1, t: 7, v: 0 });
    socket.disconnect();
});

test(`${TAG} clear targets the whole slot`, () => {
    const { socket, sent } = setup();
    socket.clear('slot-1');
    const frame = lastOp(sent);
    assert.equal(frame.data?.m, 'device.op.clear');
    assert.deepEqual(frame.data?.data, { s: 'slot-1' });
    socket.disconnect();
});

test(`${TAG} operations go only to the app that owns the slot`, () => {
    const { socket, sent, recv } = setup();
    recv({ type: 'client_attached', clientId: 'app2' });
    recv({ type: 'message', clientId: 'app2', data: snapshot('slot-2') });
    sent.length = 0;
    socket.clear('slot-2');
    socket.clear('unknown');
    assert.deepEqual(sent.map((f) => f.clientId), ['app2']);
    socket.disconnect();
});

test(`${TAG} a patch to a nested comfort limit keeps the fields it omits`, () => {
    const { socket, recv } = setup();
    recv({
        type: 'message', clientId: 'app1', data: {
            t: 'ev', ev: 'slots.patch', slots: [{ slotId: 'slot-1', slotState: { channelA: { intensityMax: 25, comfortLimit: { comfortMax: 17, absoluteMax: 25 } }, channelB: { intensityMax: 5 } } }],
        },
    });
    recv({
        type: 'message', clientId: 'app1', data: {
            t: 'ev', ev: 'slots.patch', slots: [{ slotId: 'slot-1', slotState: { channelA: { intensityMax: 42, comfortLimit: { absoluteMax: 42 } } } }],
        },
    });
    // A shallow merge would drop comfortMax here and raise the safety ceiling.
    const state = socket.devices[0].slotState;
    assert.deepEqual(state?.channelA, { intensityMax: 42, comfortLimit: { comfortMax: 17, absoluteMax: 42 } });
    assert.deepEqual(state?.channelB, { intensityMax: 5 });
    socket.disconnect();
});

test(`${TAG} an error reply is logged once per kind and never rejects unhandled`, async (t) => {
    const warn = t.mock.method(console, 'warn', () => { });
    const { socket, sent, recv } = setup();
    for (let i = 0; i < 2; i += 1) {
        socket.setTempIntensity('slot-1', V4Channel.A, 1, 300);
        recv({ type: 'message', clientId: 'app1', data: { t: 'resp', reqId: lastOp(sent).data?.reqId, error: 'invalid_operate' } });
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warn.mock.callCount(), 1);
    socket.disconnect();
});

test(`${TAG} a dropped connection reconnects with backoff`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { socket, kit } = setup();
    kit.handleClose(1006, '');
    assert.equal(socket.connectionState, 'error');
    assert.deepEqual(socket.devices, []);
    t.mock.timers.tick(1_000);
    assert.equal(socket.connectionState, 'connecting');
    socket.disconnect();
});

test(`${TAG} being replaced by another tab does not reconnect`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    t.mock.method(console, 'warn', () => { });
    const { socket, kit } = setup();
    kit.handleClose(4000, 'replaced');
    assert.equal(socket.connectionState, 'disconnected');
    t.mock.timers.tick(60_000);
    assert.equal(socket.connectionState, 'disconnected');
});

test(`${TAG} a user disconnect forgets apps and devices`, () => {
    const { socket } = setup();
    socket.disconnect();
    assert.equal(socket.connectionState, 'disconnected');
    assert.equal(socket.appCount, 0);
    assert.deepEqual(socket.devices, []);
});

test(`${TAG} the pairing deep link url-encodes the relay address`, () => {
    const link = pairingDeepLink('ws://192.168.1.5:3000/ws/dglab?tid=abc');
    assert.equal(link, 'https://dungeon-lab.com/s/?v=1&action=socket&url=ws%3A%2F%2F192.168.1.5%3A3000%2Fws%2Fdglab%3Ftid%3Dabc');
});

test(`${TAG} a carrier frame is four period bytes then four pulse width bytes`, () => {
    assert.equal(flatFrame(100), '0A0A0A0A64646464');
    assert.equal(flatFrame(50, 40), '1414141428282828');
});

test(`${TAG} the pulse rate in Hz is sent as its period in ms`, () => {
    assert.equal(pulsePeriodMs(100), 10);
    assert.equal(pulsePeriodMs(50), 20);
    assert.equal(pulsePeriodMs(10), 100);
    assert.equal(pulsePeriodMs(30), 33);
});

test(`${TAG} pulse rate stays where the period byte is valid and uncompressed`, () => {
    // A period byte below 10 makes the device drop the whole frame.
    assert.equal(clampFrequency(0), 10);
    assert.equal(clampFrequency(500), 100);
    assert.equal(clampFrequency(Number.NaN), 50);
    assert.equal(flatFrame(500), '0A0A0A0A64646464');
    assert.equal(flatFrame(1), '6464646464646464');
});

test(`${TAG} pulse width never reaches zero or exceeds the wire maximum`, () => {
    assert.equal(clampPulseWidth(0), 10);
    assert.equal(clampPulseWidth(150), 100);
    assert.equal(clampPulseWidth(Number.NaN), 100);
});

test(`${TAG} the carrier repeats one identical frame`, () => {
    const frames = carrierFrames(100, 100, 3);
    assert.equal(frames.length, 3);
    assert.deepEqual(new Set(frames), new Set(['0A0A0A0A64646464']));
});
