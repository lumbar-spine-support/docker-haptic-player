import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { V4Channel } from 'dglab-kit';

import { CoyoteBackend } from '../../src/client/components/haptic/dglab/coyoteBackend';
import type { HapticChannel } from '../../src/shared/haptics';

const TAG = '[client:dglab:backend]';

type Frame = { type: string; clientId?: string; data?: { t: string; reqId: string; m: string; data?: Record<string, unknown> } };

/** Minimal browser WebSocket: records the handshake and what is sent, and lets a test play the relay. */
class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    readonly sent: Frame[] = [];
    private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(readonly url: string, readonly protocols?: string | string[]) {
        FakeWebSocket.instances.push(this);
    }

    addEventListener(name: string, fn: (event: unknown) => void): void {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name)!.add(fn);
    }
    removeEventListener(name: string, fn: (event: unknown) => void): void { this.listeners.get(name)?.delete(fn); }
    send(data: string): void { this.sent.push(JSON.parse(data) as Frame); }
    close(): void { this.readyState = 3; }

    private dispatch(name: string, event: unknown): void {
        for (const fn of this.listeners.get(name) ?? []) fn(event);
    }
    open(): void { this.readyState = 1; this.dispatch('open', {}); }
    receive(frame: unknown): void { this.dispatch('message', { data: JSON.stringify(frame) }); }
    ops(): Frame[] { return this.sent.filter((f) => f.type === 'message' && f.data?.t === 'req'); }
}

function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
    };
}

/** Installs `window` and `WebSocket` for one test and restores them afterwards. */
function installGlobals(t: TestContext, opts: { protocol?: string; host?: string; storage?: Record<string, string> } = {}) {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, WebSocket: g.WebSocket };
    const storage = memoryStorage(opts.storage);
    g.window = { location: { protocol: opts.protocol ?? 'https:', host: opts.host ?? 'happy.example.com' }, localStorage: storage };
    g.WebSocket = FakeWebSocket;
    FakeWebSocket.instances = [];
    t.mock.method(console, 'warn', () => { });
    t.mock.method(console, 'debug', () => { });
    t.after(() => {
        g.window = saved.window;
        g.WebSocket = saved.WebSocket;
    });
    return storage;
}

const SLOT = 'U2j452hg';
const NAME = 'Coyote 3.0 (U2j452)';
const ESTIM: HapticChannel = { type: 'estim' };

function coyote(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        slotId: SLOT,
        name: 'COYOTE',
        type: 'COYOTE_030',
        props: { power: 80, channelAStatus: 0, channelBStatus: 0 },
        slotState: {
            hasDevice: true,
            markLight: 'green',
            channelA: { intensityMax: 40, isMuted: false, comfortLimit: { mode: 'simple' } },
            channelB: { intensityMax: 20, isMuted: false, comfortLimit: { mode: 'simple' } },
        },
        ...overrides,
    };
}

/** A backend connected to the relay, with one app attached that owns `devices`. */
function connected(t: TestContext, devices: unknown[] = [coyote()], opts: Parameters<typeof installGlobals>[1] = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
    const storage = installGlobals(t, opts);
    const backend = new CoyoteBackend(() => 'tok123');
    backend.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: 'hello', clientId: 'ctl-1' });
    ws.receive({ type: 'client_attached', clientId: 'app1' });
    ws.receive({ type: 'message', clientId: 'app1', data: { t: 'ev', ev: 'devices.snapshot', devices } });
    t.after(() => backend.disconnect());
    return { backend, ws, storage };
}

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

// --- Connection and pairing ---

test(`${TAG} connects to the page's relay endpoint offering the Jellyfin token as a subprotocol`, (t) => {
    installGlobals(t);
    const backend = new CoyoteBackend(() => 'secret-token');
    assert.equal(backend.connectionState, 'disconnected');
    backend.connect();
    const ws = FakeWebSocket.instances[0];
    assert.equal(ws.url, 'wss://happy.example.com/ws/dglab');
    assert.deepEqual(ws.protocols, ['happy', 'jellyfin.secret-token']);
    assert.equal(backend.connectionState, 'connecting');
    backend.disconnect();
    assert.equal(backend.connectionState, 'disconnected');
});

test(`${TAG} a configured relay address replaces the page origin`, (t) => {
    installGlobals(t);
    const backend = new CoyoteBackend(() => 't', 'http://192.168.1.10:8070');
    backend.connect();
    assert.equal(FakeWebSocket.instances[0].url, 'ws://192.168.1.10:8070/ws/dglab');
    assert.equal(backend.defaultPairingHost, '192.168.1.10:8070');
    backend.disconnect();
});

test(`${TAG} the token is read when connecting, so a later sign-in is used`, (t) => {
    installGlobals(t);
    let token = 'old';
    const backend = new CoyoteBackend(() => token);
    token = 'new';
    backend.connect();
    assert.deepEqual(FakeWebSocket.instances[0].protocols, ['happy', 'jellyfin.new']);
    backend.disconnect();
});

test(`${TAG} pairing URL appears once the relay says hello`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    installGlobals(t);
    const backend = new CoyoteBackend(() => 't');
    const states: string[] = [];
    backend.onStateChange((s) => states.push(s));
    assert.equal(backend.pairingUrl, null);
    backend.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: 'hello', clientId: 'ctl-1' });
    assert.equal(backend.connectionState, 'connected');
    assert.equal(backend.pairingUrl, 'wss://happy.example.com/ws/dglab?tid=ctl-1');
    assert.equal(backend.appCount, 0);
    ws.receive({ type: 'client_attached', clientId: 'app1' });
    assert.equal(backend.appCount, 1);
    assert.deepEqual(states, ['connecting', 'connected']);
    backend.disconnect();
});

test(`${TAG} relay traffic is reported as activity`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 5_000 });
    installGlobals(t);
    const backend = new CoyoteBackend(() => 't');
    const seen: number[] = [];
    backend.onActivity((at) => seen.push(at));
    backend.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].receive({ type: 'hello', clientId: 'x' });
    assert.deepEqual(seen, [5_000]);
    backend.disconnect();
});

test(`${TAG} a loopback page has no default pairing host and no pairing URL until one is entered`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const storage = installGlobals(t, { protocol: 'http:', host: 'localhost:8096' });
    const backend = new CoyoteBackend(() => 't');
    assert.equal(backend.defaultPairingHost, '');
    assert.equal(backend.pairingHost, '');
    backend.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].receive({ type: 'hello', clientId: 'ctl' });
    assert.equal(backend.pairingUrl, null);

    backend.setPairingHost('  http://192.168.1.5:8096/web/  ');
    assert.equal(backend.pairingHost, '192.168.1.5:8096');
    assert.equal(storage.map.get('happy-dglab-pairing-host'), '192.168.1.5:8096');
    assert.equal(backend.pairingUrl, 'ws://192.168.1.5:8096/ws/dglab?tid=ctl');

    backend.resetPairingHost();
    assert.equal(backend.pairingHost, '');
    assert.equal(storage.map.get('happy-dglab-pairing-host'), '');
    backend.disconnect();
});

test(`${TAG} re-entering the default pairing host clears the override`, (t) => {
    const storage = installGlobals(t);
    const backend = new CoyoteBackend(() => 't');
    backend.setPairingHost('other.lan');
    assert.equal(backend.pairingHost, 'other.lan');
    backend.setPairingHost('happy.example.com');
    assert.equal(backend.pairingHost, 'happy.example.com');
    assert.equal(storage.map.get('happy-dglab-pairing-host'), '');
});

test(`${TAG} persisted settings are loaded and legacy keys dropped`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const storage = installGlobals(t, {
        storage: {
            'happy-dglab-pairing-host': 'ws://saved.lan:1234/x',
            'happy-dglab-pulse-rate': JSON.stringify({ [NAME]: 500, other: 'junk' }),
            'happy-dglab-frequency': '12',
            'happy-dglab-pulse-width': '3',
        },
    });
    const backend = new CoyoteBackend(() => 't');
    assert.equal(backend.pairingHost, 'saved.lan:1234');
    assert.equal(storage.map.has('happy-dglab-frequency'), false);
    assert.equal(storage.map.has('happy-dglab-pulse-width'), false);
    backend.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: 'hello', clientId: 'c' });
    ws.receive({ type: 'client_attached', clientId: 'app1' });
    ws.receive({ type: 'message', clientId: 'app1', data: { t: 'ev', ev: 'devices.snapshot', devices: [coyote()] } });
    // The stored 500 Hz is clamped to the supported maximum.
    assert.equal(backend.getCarrierFrequency(NAME), 100);
    backend.disconnect();
});

// --- Devices and features ---

test(`${TAG} only Coyote devices are listed, with two e-stim channels each`, (t) => {
    const { backend } = connected(t, [coyote(), { slotId: 'other', name: 'X', type: 'PAWPRINTS' }]);
    assert.deepEqual(backend.devices, [{ name: NAME }]);
    const features = backend.getFeatures({ name: NAME });
    assert.deepEqual(features.map((f) => [f.id, f.label, f.kind, f.index]), [
        [`dglab#${SLOT}#${V4Channel.A}`, 'Ch. A', 'estim', 0],
        [`dglab#${SLOT}#${V4Channel.B}`, 'Ch. B', 'estim', 1],
    ]);
    assert.deepEqual(backend.getFeatures({ name: 'nope' }), []);
    assert.equal(backend.hasLinearFor(), false);
    backend.sendLinear();
});

test(`${TAG} device list changes are emitted, but slot-state churn is not`, (t) => {
    const { backend, ws } = connected(t, []);
    const lists: string[][] = [];
    let stateChanges = 0;
    backend.onDevicesChange((d) => lists.push(d.map((x) => x.name)));
    backend.onDeviceStateChange(() => { stateChanges += 1; });

    ws.receive({ type: 'message', clientId: 'app1', data: { t: 'ev', ev: 'devices.snapshot', devices: [coyote()] } });
    assert.deepEqual(lists, [[NAME]]);
    assert.equal(stateChanges, 1);

    // Live intensity traffic changes nothing that is displayed.
    ws.receive({ type: 'message', clientId: 'app1', data: { t: 'ev', ev: 'slots.patch', slots: [{ slotId: SLOT, slotState: { intensityA: 7, warmUpScale: 0.5 } }] } });
    assert.equal(lists.length, 1);
    assert.equal(stateChanges, 1);

    // Muting a channel is displayed, but is not a device change.
    ws.receive({ type: 'message', clientId: 'app1', data: { t: 'ev', ev: 'slots.patch', slots: [{ slotId: SLOT, slotState: { channelA: { isMuted: true } } }] } });
    assert.equal(lists.length, 1);
    assert.equal(stateChanges, 2);
});

test(`${TAG} the device badge shows the app's slot number and marker colour`, (t) => {
    const { backend } = connected(t, [
        coyote(),
        coyote({ slotId: 'nocolour', id: 2, slotState: { markLight: 'url(evil)' } }),
        coyote({ slotId: 'noid', id: undefined }),
    ]);
    assert.deepEqual(backend.getDeviceBadge(NAME), { icon: '1-circle-fill', color: '#198754', title: 'Slot 1' });
    assert.deepEqual(backend.getDeviceBadge('Coyote 3.0 (nocolo)'), { icon: '2-circle-fill', color: undefined, title: 'Slot 2' });
    assert.equal(backend.getDeviceBadge('Coyote 3.0 (noid)'), null);
    assert.equal(backend.getDeviceBadge('missing'), null);
});

test(`${TAG} device alerts flag a missing device and both channels muted`, (t) => {
    const muted = { intensityMax: 10, isMuted: true };
    const { backend } = connected(t, [
        coyote(),
        coyote({ slotId: 'unplugged', slotState: { hasDevice: false } }),
        coyote({ slotId: 'muted1', slotState: { channelA: muted, channelB: muted } }),
        coyote({ slotId: 'muted2', slotState: { channelA: muted, channelB: { intensityMax: 10 } } }),
    ]);
    assert.deepEqual(backend.getDeviceAlerts(NAME), []);
    assert.deepEqual(backend.getDeviceAlerts('Coyote 3.0 (unplug)'), [{ level: 'danger', message: 'Device not connected to DG-Lab' }]);
    assert.deepEqual(backend.getDeviceAlerts('Coyote 3.0 (muted1)'), [{ level: 'warning', message: 'Both output channels muted in DG-Lab' }]);
    assert.deepEqual(backend.getDeviceAlerts('Coyote 3.0 (muted2)'), []);
    assert.deepEqual(backend.getDeviceAlerts('missing'), []);
});

test(`${TAG} feature details show output, mode and the absolute limit`, (t) => {
    const { backend } = connected(t, [coyote({ slotState: { channelA: { intensityMax: 40 }, channelB: { intensityMax: 20, isMuted: true, comfortLimit: { mode: 'simple' } } } })]);
    assert.deepEqual(backend.getFeatureDetails(`dglab#${SLOT}#${V4Channel.A}`), [
        { label: 'Output', value: 'Enabled', warn: false },
        { label: 'Mode', value: 'unknown' },
        { label: 'Absolute Limit', value: '40 / 200' },
    ]);
    assert.deepEqual(backend.getFeatureDetails(`dglab#${SLOT}#${V4Channel.B}`), [
        { label: 'Output', value: 'Muted', warn: true },
        { label: 'Mode', value: 'simple' },
        { label: 'Absolute Limit', value: '20 / 200' },
    ]);
    assert.deepEqual(backend.getFeatureDetails('dglab#missing#0'), []);
});

test(`${TAG} battery is the reported power as a fraction, or null when not reported`, async (t) => {
    const { backend } = connected(t, [
        coyote(),
        coyote({ slotId: 'frac', props: { power: 0.4 } }),
        coyote({ slotId: 'zero', props: { power: 0 } }),
        coyote({ slotId: 'none', props: {} }),
    ]);
    assert.equal(await backend.getBatteryLevel({ name: NAME }), 0.8);
    assert.equal(await backend.getBatteryLevel({ name: 'Coyote 3.0 (frac)' }), 0.4);
    assert.equal(await backend.getBatteryLevel({ name: 'Coyote 3.0 (zero)' }), null);
    assert.equal(await backend.getBatteryLevel({ name: 'Coyote 3.0 (none)' }), null);
    assert.equal(await backend.getBatteryLevel({ name: 'missing' }), null);
});

// --- Settings ---

test(`${TAG} pulse rate is per device, clamped and persisted; unknown devices have none`, (t) => {
    const { backend, storage } = connected(t);
    assert.equal(backend.getCarrierFrequency(NAME), 50);
    assert.equal(backend.getCarrierFrequency('missing'), null);
    backend.setCarrierFrequency(NAME, 3);
    assert.equal(backend.getCarrierFrequency(NAME), 10);
    assert.deepEqual(JSON.parse(storage.map.get('happy-dglab-pulse-rate')!), { [NAME]: 10 });
    assert.equal(backend.getOutputChannels()[0].pulse.frequency, 10);
});

test(`${TAG} assignments are emitted only when they change`, (t) => {
    const { backend, storage } = connected(t);
    const id = `dglab#${SLOT}#${V4Channel.A}`;
    const snapshots: Array<[string, string][]> = [];
    backend.onAssignmentsChange((m) => snapshots.push([...m]));
    assert.equal(backend.hasFeaturesFor(ESTIM), false);

    backend.setFeatureChannel(id, ESTIM);
    backend.setFeatureChannel(id, ESTIM);
    assert.equal(backend.getFeatureChannel(id), 'estim');
    assert.equal(backend.hasFeaturesFor(ESTIM), true);
    assert.equal(backend.hasFeaturesFor({ type: 'estim', sub: 'b' }), false);
    assert.ok(storage.map.get('happy-dglab-assignments')?.includes('estim'));

    backend.setFeatureChannel(id, null);
    assert.equal(backend.getFeatureChannel(id), null);
    assert.deepEqual(snapshots, [[[id, 'estim']], []]);
});

test(`${TAG} output channels hold the device strength times the app's ceiling`, (t) => {
    const { backend } = connected(t, [coyote({ props: { channelAStatus: 0, channelBStatus: 1 } })]);
    assert.equal(backend.getDeviceStrength(NAME), 1);
    backend.setDeviceStrength(NAME, 0.5);
    assert.equal(backend.getDeviceStrength(NAME), 0.5);
    const outputs = backend.getOutputChannels();
    assert.deepEqual(outputs.map((o) => [o.label, o.level, o.ceiling]), [
        [`${NAME} · Ch. A`, 20, 40],
        // A channel with no electrode circuit cannot play, whatever its ceiling.
        [`${NAME} · Ch. B`, 0, 20],
    ]);
});

test(`${TAG} channel health counts assigned channels and which of them can play`, (t) => {
    const { backend } = connected(t, [coyote({ props: { channelAStatus: 0, channelBStatus: 3 } })]);
    assert.deepEqual(backend.getChannelHealth(ESTIM), { total: 0, usable: 0, alerts: [] });
    backend.setFeatureChannel(`dglab#${SLOT}#${V4Channel.A}`, ESTIM);
    backend.setFeatureChannel(`dglab#${SLOT}#${V4Channel.B}`, ESTIM);
    assert.deepEqual(backend.getChannelHealth(ESTIM), {
        total: 2,
        usable: 1,
        alerts: [{ level: 'danger', message: 'Channel B: damaged' }],
    });
});

// --- Output ---

test(`${TAG} continuous output holds strength and streams pulse frames to assigned channels only`, (t) => {
    const { backend, ws } = connected(t);
    backend.setFeatureChannel(`dglab#${SLOT}#${V4Channel.A}`, ESTIM);
    ws.sent.length = 0;

    backend.sendContinuous(ESTIM, 0.7);
    const ops = ws.ops();
    assert.equal(ops.length, 2);
    assert.ok(ops.every((f) => f.clientId === 'app1' && f.data?.m === 'device.op'));
    // SetTempIntensity at full device strength × ceiling 40, then an AppendPulseData batch.
    assert.deepEqual([ops[0].data?.data?.t, ops[0].data?.data?.c, ops[0].data?.data?.v], [4, V4Channel.A, 40]);
    assert.deepEqual([ops[1].data?.data?.t, ops[1].data?.data?.c, ops[1].data?.data?.seq], [0, V4Channel.A, 1]);

    // A second batch continues the queue with the next sequence number.
    t.mock.timers.tick(600);
    ws.sent.length = 0;
    backend.sendContinuous(ESTIM, 0.7);
    const pulse = ws.ops().find((f) => f.data?.data?.t === 0);
    assert.equal(pulse?.data?.data?.seq, 2);
});

test(`${TAG} a look-ahead sampler with no points switches the channel off`, (t) => {
    const { backend, ws } = connected(t);
    backend.setFeatureChannel(`dglab#${SLOT}#${V4Channel.B}`, ESTIM);
    backend.sendContinuous(ESTIM, 1, () => 0.5);
    ws.sent.length = 0;
    backend.sendContinuous(ESTIM, 1, () => null);
    const ops = ws.ops();
    assert.equal(ops.length, 1);
    assert.deepEqual([ops[0].data?.data?.t, ops[0].data?.data?.c, ops[0].data?.data?.v], [4, V4Channel.B, 0]);
});

test(`${TAG} nothing is sent while not connected`, (t) => {
    installGlobals(t);
    const backend = new CoyoteBackend(() => 't');
    backend.sendContinuous(ESTIM, 1);
    backend.sendToFeature('dglab#x#0', () => 1);
    assert.equal(FakeWebSocket.instances.length, 0);
});

test(`${TAG} sendToFeature drives one channel regardless of assignment`, (t) => {
    const { backend, ws } = connected(t);
    ws.sent.length = 0;
    backend.sendToFeature(`dglab#${SLOT}#${V4Channel.B}`, () => 1);
    const ops = ws.ops();
    assert.ok(ops.length >= 1);
    assert.ok(ops.every((f) => f.data?.data?.c === V4Channel.B));
    assert.equal(ops[0].data?.data?.v, 20);
});

test(`${TAG} a channel without a ceiling or muted in the app is warned about once`, (t) => {
    const { backend } = connected(t, [coyote({ slotState: { channelA: { isMuted: true } } })]);
    const warn = console.warn as unknown as { mock: { callCount(): number; calls: Array<{ arguments: unknown[] }> } };
    const before = warn.mock.callCount();
    for (let i = 0; i < 3; i += 1) backend.sendToFeature(`dglab#${SLOT}#${V4Channel.A}`, () => 1);
    const messages = warn.mock.calls.slice(before).map((c) => String(c.arguments[1]));
    assert.equal(messages.length, 2);
    assert.match(messages[0], /no usable limit/);
    assert.match(messages[1], /channel A is muted/);
});

test(`${TAG} stopAll clears and resets every channel, holding output until the app answers`, async (t) => {
    const { backend, ws } = connected(t);
    backend.setFeatureChannel(`dglab#${SLOT}#${V4Channel.A}`, ESTIM);
    backend.sendContinuous(ESTIM, 1);
    ws.sent.length = 0;

    await backend.stopAll();
    const ops = ws.ops();
    assert.deepEqual(ops.map((f) => f.data?.m), ['device.op.clear', 'device.op', 'device.op']);
    assert.deepEqual(ops.slice(1).map((f) => [f.data?.data?.t, f.data?.data?.c]), [[7, V4Channel.A], [7, V4Channel.B]]);

    // Held: nothing may follow the reset before it has landed.
    ws.sent.length = 0;
    backend.sendContinuous(ESTIM, 1);
    assert.equal(ws.ops().length, 0);

    for (const op of ops) ws.receive({ type: 'message', clientId: 'app1', data: { t: 'resp', reqId: op.data?.reqId, result: {} } });
    await flush();
    // Answered, but the settle gap has not passed yet.
    backend.sendContinuous(ESTIM, 1);
    assert.equal(ws.ops().length, 0);

    t.mock.timers.tick(200);
    await flush();
    backend.sendContinuous(ESTIM, 1);
    // A fresh scheduler starts over: strength first, then a replacing pulse batch.
    assert.deepEqual(ws.ops().map((f) => f.data?.data?.t), [4, 0]);
    assert.equal(ws.ops()[1].data?.data?.im, true);
});

test(`${TAG} stopAll resumes after a timeout if the app never answers`, async (t) => {
    const { backend, ws } = connected(t);
    backend.setFeatureChannel(`dglab#${SLOT}#${V4Channel.A}`, ESTIM);
    await backend.stopAll();
    ws.sent.length = 0;
    t.mock.timers.tick(999);
    await flush();
    backend.sendContinuous(ESTIM, 1);
    assert.equal(ws.ops().length, 0);
    t.mock.timers.tick(1);
    await flush();
    backend.sendContinuous(ESTIM, 1);
    assert.ok(ws.ops().length > 0);
});

test(`${TAG} only the latest stopAll releases the hold`, async (t) => {
    const { backend, ws } = connected(t);
    backend.setFeatureChannel(`dglab#${SLOT}#${V4Channel.A}`, ESTIM);
    await backend.stopAll();
    t.mock.timers.tick(500);
    await backend.stopAll();
    ws.sent.length = 0;
    // The first hold expires here, but the second one is still pending.
    t.mock.timers.tick(500);
    await flush();
    backend.sendContinuous(ESTIM, 1);
    assert.equal(ws.ops().length, 0);
    t.mock.timers.tick(500);
    await flush();
    backend.sendContinuous(ESTIM, 1);
    assert.ok(ws.ops().length > 0);
});

test(`${TAG} stopAll while disconnected sends nothing`, async (t) => {
    installGlobals(t);
    const backend = new CoyoteBackend(() => 't');
    await backend.stopAll();
    assert.equal(FakeWebSocket.instances.length, 0);
});

test(`${TAG} disconnect stops all output before closing`, (t) => {
    const { backend, ws } = connected(t);
    ws.sent.length = 0;
    backend.disconnect();
    assert.equal(ws.ops()[0]?.data?.m, 'device.op.clear');
    assert.equal(backend.connectionState, 'disconnected');
    assert.deepEqual(backend.devices, []);
});
