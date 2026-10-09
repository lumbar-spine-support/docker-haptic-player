import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JellyfinConnection, JellyfinSignInError, randomDeviceId } from '../../src/client/jellyfin/connection';

const TAG = '[client:jellyfin-connection]';
const SERVER = 'https://jf.example.com';
const SESSION_KEY = 'happy-jellyfin-session';
const DEVICE_ID_KEY = 'happy-jellyfin-device-id';
const WEB_CREDENTIALS_KEY = 'jellyfin_credentials';
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

/** In-memory localStorage; `broken` makes every access throw, like blocked storage. */
class MemoryStorage {
    readonly data = new Map<string, string>();
    broken = false;
    getItem(key: string): string | null {
        if (this.broken) throw new Error('SecurityError');
        return this.data.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        if (this.broken) throw new Error('QuotaExceededError');
        this.data.set(key, value);
    }
    removeItem(key: string): void {
        if (this.broken) throw new Error('SecurityError');
        this.data.delete(key);
    }
}

interface Call { url: string; init?: RequestInit }

let storage: MemoryStorage;
let calls: Call[];
let respond: (call: Call) => Response | Promise<Response>;
let userAgent: string;
const saved = new Map<string, PropertyDescriptor | undefined>();
const originalConsole = { warn: console.warn, error: console.error };
const logged: { level: string; args: unknown[] }[] = [];

function stubGlobal(name: string, descriptor: PropertyDescriptor): void {
    if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, ...descriptor });
}

beforeEach(() => {
    storage = new MemoryStorage();
    calls = [];
    respond = () => new Response('{}', { status: 200 });
    userAgent = FIREFOX_UA;
    logged.length = 0;
    stubGlobal('localStorage', { value: storage, writable: true });
    stubGlobal('navigator', { get: () => ({ userAgent }) });
    stubGlobal('fetch', {
        writable: true,
        value: async (input: string | URL | Request, init?: RequestInit) => {
            const call = { url: String(input), init };
            calls.push(call);
            return respond(call);
        },
    });
    console.warn = (...args: unknown[]) => { logged.push({ level: 'warn', args }); };
    console.error = (...args: unknown[]) => { logged.push({ level: 'error', args }); };
});

afterEach(() => {
    for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
    }
    saved.clear();
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function storeSession(session: object): void {
    storage.data.set(SESSION_KEY, JSON.stringify(session));
}

function authHeader(call: Call): string {
    return new Headers(call.init?.headers).get('Authorization') ?? '';
}

const noop = (): void => {};

test(`${TAG} randomDeviceId is 32 hex characters and differs each time`, () => {
    const a = randomDeviceId();
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, randomDeviceId());
});

test(`${TAG} starts signed out without a stored session`, () => {
    const conn = new JellyfinConnection(SERVER, noop);
    assert.equal(conn.signedIn, false);
    assert.equal(conn.borrowed, false);
    assert.equal(conn.userId, '');
    assert.equal(conn.userName, '');
    assert.deepEqual(conn.endpoint, { serverUrl: SERVER, token: '' });
});

test(`${TAG} restores the stored session for the same server`, () => {
    storeSession({ serverUrl: SERVER, token: 'tok', userId: 'u1', userName: 'Alice' });
    const conn = new JellyfinConnection(SERVER, noop);
    assert.equal(conn.signedIn, true);
    assert.equal(conn.borrowed, false);
    assert.equal(conn.userId, 'u1');
    assert.equal(conn.userName, 'Alice');
    assert.deepEqual(conn.endpoint, { serverUrl: SERVER, token: 'tok' });
});

test(`${TAG} ignores a session stored for another server`, () => {
    storeSession({ serverUrl: 'https://other.example.com', token: 'tok', userId: 'u1', userName: 'Alice' });
    assert.equal(new JellyfinConnection(SERVER, noop).signedIn, false);
});

test(`${TAG} ignores a corrupt stored session`, () => {
    storage.data.set(SESSION_KEY, '{not json');
    assert.equal(new JellyfinConnection(SERVER, noop).signedIn, false);
});

test(`${TAG} blocked storage means signed out, not a crash`, async () => {
    storage.broken = true;
    const conn = new JellyfinConnection(SERVER, noop);
    assert.equal(conn.signedIn, false);
    // Signing in still works; the session just is not persisted.
    respond = () => json({ AccessToken: 'tok', User: { Id: 'u1', Name: 'Alice' } });
    await conn.signIn('alice', 'pw');
    assert.equal(conn.signedIn, true);
    assert.equal(storage.data.size, 0);
    await conn.signOut();
    assert.equal(conn.signedIn, false);
});

test(`${TAG} signIn posts the credentials and stores the session`, async () => {
    respond = () => json({ AccessToken: 'tok', User: { Id: 'u1', Name: 'Alice' } });
    const conn = new JellyfinConnection(SERVER, noop);
    await conn.signIn('alice', 's3cret');

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, `${SERVER}/Users/AuthenticateByName`);
    assert.equal(call.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(call.init?.body)), { Username: 'alice', Pw: 's3cret' });
    const auth = authHeader(call);
    assert.match(auth, /^MediaBrowser Client="HAPPY", Device="HAPPY on Firefox", DeviceId="[0-9a-f]{32}", Version="1"$/);

    assert.equal(conn.signedIn, true);
    assert.equal(conn.userId, 'u1');
    assert.equal(conn.userName, 'Alice');
    assert.equal(conn.borrowed, false);
    assert.deepEqual(JSON.parse(storage.data.get(SESSION_KEY)!), { serverUrl: SERVER, token: 'tok', userId: 'u1', userName: 'Alice' });
    // A new connection (page reload) picks the session up again.
    assert.equal(new JellyfinConnection(SERVER, noop).userName, 'Alice');
});

test(`${TAG} the device id is created once and reused`, async () => {
    const conn = new JellyfinConnection(SERVER, noop);
    await conn.request('/a');
    await conn.request('/b');
    const id = storage.data.get(DEVICE_ID_KEY);
    assert.match(id ?? '', /^[0-9a-f]{32}$/);
    for (const call of calls) assert.ok(authHeader(call).includes(`DeviceId="${id}"`));

    storage.data.set(DEVICE_ID_KEY, 'existing-id');
    await conn.request('/c');
    assert.ok(authHeader(calls[2]).includes('DeviceId="existing-id"'));
});

test(`${TAG} the device name names the browser`, async () => {
    const conn = new JellyfinConnection(SERVER, noop);
    const cases: [string, string][] = [
        ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', 'Edge'],
        [FIREFOX_UA, 'Firefox'],
        ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Chrome'],
        ['Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari'],
        ['curl/8.0', 'Browser'],
    ];
    for (const [ua, browser] of cases) {
        userAgent = ua;
        await conn.request('/x');
        assert.ok(authHeader(calls[calls.length - 1]).includes(`Device="HAPPY on ${browser}"`), `${ua} -> ${browser}`);
    }
});

test(`${TAG} signIn rejects wrong credentials with status 401`, async () => {
    respond = () => new Response('', { status: 401 });
    const conn = new JellyfinConnection(SERVER, noop);
    await assert.rejects(conn.signIn('alice', 'wrong'), (err: unknown) => {
        assert.ok(err instanceof JellyfinSignInError);
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Wrong user name or password.');
        return true;
    });
    assert.equal(conn.signedIn, false);
    assert.equal(storage.data.has(SESSION_KEY), false);
});

test(`${TAG} signIn reports other HTTP errors and an unreachable server`, async () => {
    const conn = new JellyfinConnection(SERVER, noop);
    respond = () => new Response('', { status: 500 });
    await assert.rejects(conn.signIn('a', 'b'), { status: 500, message: 'Sign-in failed (HTTP 500).' });
    respond = () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(conn.signIn('a', 'b'), { status: 0, message: 'Jellyfin server is not reachable.' });
    assert.equal(conn.signedIn, false);
});

test(`${TAG} signOut ends an own session on the server and forgets it`, async () => {
    storeSession({ serverUrl: SERVER, token: 'tok', userId: 'u1', userName: 'Alice' });
    const conn = new JellyfinConnection(SERVER, noop);
    await conn.signOut();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${SERVER}/Sessions/Logout`);
    assert.equal(calls[0].init?.method, 'POST');
    assert.ok(authHeader(calls[0]).endsWith(', Token="tok"'));
    assert.equal(conn.signedIn, false);
    assert.equal(storage.data.has(SESSION_KEY), false);
});

test(`${TAG} signOut forgets the session even when the logout request fails`, async () => {
    storeSession({ serverUrl: SERVER, token: 'tok', userId: 'u1', userName: 'Alice' });
    respond = () => { throw new TypeError('offline'); };
    const conn = new JellyfinConnection(SERVER, noop);
    await conn.signOut();
    assert.equal(conn.signedIn, false);
    assert.equal(storage.data.has(SESSION_KEY), false);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].level, 'warn');
});

test(`${TAG} signOut without a session sends nothing`, async () => {
    await new JellyfinConnection(SERVER, noop).signOut();
    assert.equal(calls.length, 0);
});

test(`${TAG} signOut of a borrowed session leaves Jellyfin's web client signed in`, async () => {
    storeSession({ serverUrl: SERVER, token: 'tok', userId: 'u1', userName: 'Alice', borrowed: true });
    const conn = new JellyfinConnection(SERVER, noop);
    assert.equal(conn.borrowed, true);
    await conn.signOut();
    assert.equal(calls.length, 0);
    assert.equal(conn.signedIn, false);
    assert.equal(storage.data.has(SESSION_KEY), false);
});

test(`${TAG} request sends the token, keeps other headers and returns the response`, async () => {
    storeSession({ serverUrl: SERVER, token: 'tok', userId: 'u1', userName: 'Alice' });
    respond = () => json({ ok: 1 });
    const conn = new JellyfinConnection(SERVER, noop);
    const res = await conn.request('/Items?x=1', { method: 'DELETE', headers: { 'X-Extra': 'yes', Authorization: 'overridden' } });
    assert.deepEqual(await res.json(), { ok: 1 });
    assert.equal(calls[0].url, `${SERVER}/Items?x=1`);
    assert.equal(calls[0].init?.method, 'DELETE');
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get('X-Extra'), 'yes');
    assert.match(headers.get('Authorization') ?? '', /^MediaBrowser .*Token="tok"$/);
});

test(`${TAG} a rejected token signs out and asks to sign in again`, async () => {
    storeSession({ serverUrl: SERVER, token: 'expired', userId: 'u1', userName: 'Alice' });
    let unauthorized = 0;
    const conn = new JellyfinConnection(SERVER, () => { unauthorized++; });
    respond = () => new Response('', { status: 401 });
    const res = await conn.request('/Items');
    assert.equal(res.status, 401);
    assert.equal(unauthorized, 1);
    assert.equal(conn.signedIn, false);
    assert.equal(storage.data.has(SESSION_KEY), false);
    assert.equal(logged.filter((l) => l.level === 'error').length, 1);

    // Signed out already: a further 401 does not trigger the sign-in again.
    await conn.request('/Items');
    assert.equal(unauthorized, 1);
});

test(`${TAG} adopting Jellyfin web's sign-in`, async (t) => {
    const webCredentials = JSON.stringify({ Servers: [{ ManualAddress: SERVER, AccessToken: 'webtok', UserId: 'web-user' }] });

    await t.test('is a no-op when already signed in', async () => {
        storeSession({ serverUrl: SERVER, token: 'tok', userId: 'u1', userName: 'Alice' });
        storage.data.set(WEB_CREDENTIALS_KEY, webCredentials);
        const conn = new JellyfinConnection(SERVER, noop);
        assert.equal(await conn.adoptJellyfinWebSession(), true);
        assert.equal(calls.length, 0);
        assert.equal(conn.borrowed, false);
        storage.data.clear();
    });

    await t.test('fails without Jellyfin web credentials', async () => {
        const conn = new JellyfinConnection(SERVER, noop);
        assert.equal(await conn.adoptJellyfinWebSession(), false);
        assert.equal(calls.length, 0);
        assert.equal(conn.signedIn, false);
    });

    await t.test('checks the token with /Users/Me and stores a borrowed session', async () => {
        storage.data.set(WEB_CREDENTIALS_KEY, webCredentials);
        respond = () => json({ Id: 'me-id', Name: 'Bob' });
        const conn = new JellyfinConnection(SERVER, noop);
        assert.equal(await conn.adoptJellyfinWebSession(), true);
        const call = calls[calls.length - 1];
        assert.equal(call.url, `${SERVER}/Users/Me`);
        assert.ok(authHeader(call).endsWith('Token="webtok"'));
        assert.equal(conn.signedIn, true);
        assert.equal(conn.borrowed, true);
        assert.equal(conn.userId, 'me-id');
        assert.equal(conn.userName, 'Bob');
        assert.deepEqual(conn.endpoint, { serverUrl: SERVER, token: 'webtok' });
        assert.deepEqual(JSON.parse(storage.data.get(SESSION_KEY)!),
            { serverUrl: SERVER, token: 'webtok', userId: 'me-id', userName: 'Bob', borrowed: true });
        storage.data.delete(SESSION_KEY);
    });

    await t.test('falls back to the stored user id when /Users/Me omits it', async () => {
        storage.data.set(WEB_CREDENTIALS_KEY, webCredentials);
        respond = () => json({});
        const conn = new JellyfinConnection(SERVER, noop);
        assert.equal(await conn.adoptJellyfinWebSession(), true);
        assert.equal(conn.userId, 'web-user');
        assert.equal(conn.userName, '');
        storage.data.delete(SESSION_KEY);
    });

    await t.test('fails when Jellyfin rejects the token', async () => {
        storage.data.set(WEB_CREDENTIALS_KEY, webCredentials);
        respond = () => new Response('', { status: 401 });
        const conn = new JellyfinConnection(SERVER, noop);
        assert.equal(await conn.adoptJellyfinWebSession(), false);
        assert.equal(conn.signedIn, false);
        assert.equal(storage.data.has(SESSION_KEY), false);
    });

    await t.test('fails when Jellyfin is unreachable or answers garbage', async () => {
        storage.data.set(WEB_CREDENTIALS_KEY, webCredentials);
        const conn = new JellyfinConnection(SERVER, noop);
        respond = () => { throw new TypeError('offline'); };
        assert.equal(await conn.adoptJellyfinWebSession(), false);
        respond = () => new Response('<html>', { status: 200 });
        assert.equal(await conn.adoptJellyfinWebSession(), false);
        assert.equal(conn.signedIn, false);
    });
});
