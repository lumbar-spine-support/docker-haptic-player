import { test, type TestContext } from 'node:test';
import assert from 'node:assert';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { setLogLevel } from '../src/logger';
import { describeClose, formatDuration, PeerLink, remoteAddress } from '../src/peerLink';

const TAG = '[dglab-relay:peerLink]';

interface Logged { level: 'info' | 'warn'; text: string }

/** A link on a fake socket with a mocked clock, collecting what it logs. */
function setup(t: TestContext, bufferedAmount = 0): { link: PeerLink; logged: Logged[]; socket: { bufferedAmount: number } } {
    setLogLevel('info');
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const logged: Logged[] = [];
    t.mock.method(console, 'log', (...args: unknown[]) => { logged.push({ level: 'info', text: args.join(' ') }); });
    t.mock.method(console, 'warn', (...args: unknown[]) => { logged.push({ level: 'warn', text: args.join(' ') }); });
    const socket = { bufferedAmount };
    return { link: new PeerLink('Controller', socket as unknown as WebSocket, '10.0.0.2'), logged, socket };
}

const warnings = (logged: Logged[]): string[] => logged.filter((l) => l.level === 'warn').map((l) => l.text);

test(`${TAG} warns when a peer that pings goes silent`, (t) => {
    const { link, logged } = setup(t);
    link.received('ping');
    t.mock.timers.tick(2_000);
    link.received('ping');
    assert.deepEqual(warnings(logged), []);

    t.mock.timers.tick(7_300);
    link.received('ping');
    assert.match(warnings(logged)[0] ?? '', /Controller was silent for 7\.3 s/);
});

test(`${TAG} stays quiet about silence from a peer that never pings`, (t) => {
    const { link, logged } = setup(t);
    link.received('message');
    t.mock.timers.tick(60_000);
    link.received('message');
    assert.deepEqual(warnings(logged), []);
});

test(`${TAG} warns about slow and missing native pongs`, (t) => {
    const { link, logged } = setup(t);
    link.pinged();
    t.mock.timers.tick(1_500);
    link.ponged();
    assert.match(warnings(logged)[0] ?? '', /answered a native ping after 1\.5 s/);

    link.pinged();
    t.mock.timers.tick(10_000);
    link.pinged();
    assert.match(warnings(logged)[1] ?? '', /has not answered native pings for 10\.0 s/);
    t.mock.timers.tick(500);
    link.ponged();
    assert.match(logged[logged.length - 1]?.text ?? '', /answers native pings again after 10\.5 s/);
    assert.equal(link.missedPongs, 0);
});

test(`${TAG} warns once while the outgoing queue is backed up`, (t) => {
    const { link, logged, socket } = setup(t, 32 * 1024);
    link.sent();
    link.sent();
    assert.equal(warnings(logged).length, 1);
    assert.match(warnings(logged)[0] ?? '', /32 KiB queued/);
    socket.bufferedAmount = 0;
    link.sent();
    assert.match(logged[logged.length - 1]?.text ?? '', /caught up/);
});

test(`${TAG} logs an abnormal close as a warning with its history`, (t) => {
    const { link, logged } = setup(t);
    link.received('ping');
    t.mock.timers.tick(4_000);
    link.closed(1000, 'ping_timeout');
    const [warning] = warnings(logged);
    assert.match(warning ?? '', /Controller closed: code 1000 \(normal\), reason "ping_timeout" \(the peer got no pong/);
    assert.match(warning ?? '', /after 4\.0 s; last frame 4\.0 s ago, 1 frames in, 0 out/);
});

test(`${TAG} logs closes the relay made itself, or a normal close, at info`, (t) => {
    const { link, logged } = setup(t);
    link.closing('replaced');
    link.closed(4000, 'replaced');
    link.closed(1001, '');
    assert.deepEqual(warnings(logged), []);
    assert.match(logged[0]?.text ?? '', /Controller closed by the relay \(replaced\)/);
});

test(`${TAG} describes close codes and durations`, () => {
    assert.equal(describeClose(1006, ''), 'code 1006 (abnormal, connection dropped without a close frame)');
    assert.equal(describeClose(4321, 'x'), 'code 4321, reason "x"');
    assert.equal(formatDuration(850), '850 ms');
    assert.equal(formatDuration(723_000), '12 min 3 s');
});

test(`${TAG} prefers the first X-Forwarded-For hop as the remote address`, () => {
    const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: '172.18.0.5' } }) as unknown as IncomingMessage;
    assert.equal(remoteAddress(req({ 'x-forwarded-for': '192.168.1.20, 172.18.0.1' })), '192.168.1.20');
    assert.equal(remoteAddress(req({})), '172.18.0.5');
});
