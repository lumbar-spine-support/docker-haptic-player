import type { JellyfinAuthResult } from './dto';
import type { JellyfinApi } from './library';
import type { JellyfinEndpoint } from './urls';

const SESSION_KEY = 'happy-jellyfin-session';
const DEVICE_ID_KEY = 'happy-jellyfin-device-id';
/** Where jellyfin-web keeps its sign-in; HAPPY shares the origin, so it can read it. */
const JELLYFIN_WEB_CREDENTIALS_KEY = 'jellyfin_credentials';

interface StoredSession {
    serverUrl: string;
    token: string;
    userId: string;
    userName: string;
    /** Taken over from Jellyfin's web client; signing out of HAPPY must not end that session. */
    borrowed?: boolean;
}

interface JellyfinWebServer {
    AccessToken?: unknown;
    UserId?: unknown;
    ManualAddress?: unknown;
    LocalAddress?: unknown;
}

/**
 * The signed-in user of Jellyfin's web client, from its `jellyfin_credentials`. Prefers the server
 * entry whose address matches `serverUrl`, otherwise takes the first one that has a token: HAPPY and
 * jellyfin-web share the origin, so their server is the same.
 */
export function credentialsFromJellyfinWeb(raw: string | null, serverUrl: string): { token: string; userId: string } | null {
    let servers: JellyfinWebServer[];
    try {
        const parsed = JSON.parse(raw ?? '') as { Servers?: unknown };
        servers = Array.isArray(parsed?.Servers) ? parsed.Servers as JellyfinWebServer[] : [];
    } catch {
        return null;
    }
    const usable = servers.filter((s) => typeof s?.AccessToken === 'string' && s.AccessToken !== ''
        && typeof s.UserId === 'string' && s.UserId !== '');
    const normalize = (url: unknown): string => (typeof url === 'string' ? url.replace(/\/+$/, '').toLowerCase() : '');
    const target = normalize(serverUrl);
    const server = usable.find((s) => normalize(s.ManualAddress) === target || normalize(s.LocalAddress) === target) ?? usable[0];
    return server ? { token: server.AccessToken as string, userId: server.UserId as string } : null;
}

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Private mode or blocked storage: the session simply lasts until the page closes.
    }
}

/**
 * A random device id. `crypto.randomUUID` only exists in secure contexts, and Jellyfin (which serves
 * HAPPY) is often reached over plain HTTP on a LAN address; `getRandomValues` works everywhere.
 */
export function randomDeviceId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Jellyfin lists every sign-in under Dashboard → Devices; a stable id keeps that to one entry per browser. */
function deviceId(): string {
    let id = readStorage(DEVICE_ID_KEY);
    if (!id) {
        id = randomDeviceId();
        writeStorage(DEVICE_ID_KEY, id);
    }
    return id;
}

function deviceName(): string {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return `HAPPY on ${browser}`;
}

/** Thrown by {@link JellyfinConnection.signIn}; `status` 401 means wrong credentials. */
export class JellyfinSignInError extends Error {
    constructor(readonly status: number) {
        super(status === 401 ? 'Wrong user name or password.' : status === 0 ? 'Jellyfin server is not reachable.' : `Sign-in failed (HTTP ${status}).`);
    }
}

/**
 * The browser's Jellyfin session. The access token lives in localStorage, keyed to the server
 * address, and is sent as a `MediaBrowser` authorization header (or `ApiKey` where a URL is
 * all a media element can take).
 */
export class JellyfinConnection implements JellyfinApi {
    private session: StoredSession | null;

    constructor(readonly serverUrl: string, private readonly onUnauthorized: () => void) {
        const stored = readStorage(SESSION_KEY);
        let session: StoredSession | null = null;
        try {
            session = stored ? JSON.parse(stored) as StoredSession : null;
        } catch {
            session = null;
        }
        this.session = session?.serverUrl === serverUrl ? session : null;
    }

    get signedIn(): boolean {
        return this.session !== null;
    }

    /** The session belongs to Jellyfin's web client (see {@link adoptJellyfinWebSession}). */
    get borrowed(): boolean {
        return this.session?.borrowed === true;
    }

    /**
     * Takes over the sign-in of Jellyfin's web client on the same origin, so following HAPPY's link
     * in Jellyfin's menu needs no second sign-in. False when there is none or Jellyfin rejects it.
     */
    async adoptJellyfinWebSession(): Promise<boolean> {
        if (this.session) return true;
        const credentials = credentialsFromJellyfinWeb(readStorage(JELLYFIN_WEB_CREDENTIALS_KEY), this.serverUrl);
        if (!credentials) return false;
        try {
            const res = await fetch(`${this.serverUrl}/Users/Me`, {
                headers: { Authorization: `MediaBrowser Client="HAPPY", Device="${deviceName()}", DeviceId="${deviceId()}", Version="1", Token="${credentials.token}"` },
            });
            if (!res.ok) return false;
            const me = await res.json() as { Id?: string; Name?: string };
            this.session = { serverUrl: this.serverUrl, token: credentials.token, userId: me.Id ?? credentials.userId, userName: me.Name ?? '', borrowed: true };
            writeStorage(SESSION_KEY, JSON.stringify(this.session));
            return true;
        } catch {
            return false;
        }
    }

    get userId(): string {
        return this.session?.userId ?? '';
    }

    get userName(): string {
        return this.session?.userName ?? '';
    }

    get endpoint(): JellyfinEndpoint {
        return { serverUrl: this.serverUrl, token: this.session?.token ?? '' };
    }

    private authorization(): string {
        const parts = [`Client="HAPPY"`, `Device="${deviceName()}"`, `DeviceId="${deviceId()}"`, `Version="1"`];
        if (this.session) parts.push(`Token="${this.session.token}"`);
        return `MediaBrowser ${parts.join(', ')}`;
    }

    async signIn(username: string, password: string): Promise<void> {
        let res: Response;
        try {
            res = await fetch(`${this.serverUrl}/Users/AuthenticateByName`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: this.authorization() },
                body: JSON.stringify({ Username: username, Pw: password }),
            });
        } catch {
            throw new JellyfinSignInError(0);
        }
        if (!res.ok) throw new JellyfinSignInError(res.status);
        const result = await res.json() as JellyfinAuthResult;
        this.session = { serverUrl: this.serverUrl, token: result.AccessToken, userId: result.User.Id, userName: result.User.Name };
        writeStorage(SESSION_KEY, JSON.stringify(this.session));
    }

    /**
     * Ends the session on the server too, so the device entry disappears from Jellyfin's dashboard.
     * A borrowed session is only forgotten: it is Jellyfin's web client's, which stays signed in.
     */
    async signOut(): Promise<void> {
        if (this.session && !this.session.borrowed) {
            try {
                await fetch(`${this.serverUrl}/Sessions/Logout`, { method: 'POST', headers: { Authorization: this.authorization() } });
            } catch (err) {
                console.warn('[jellyfin] Logout request failed', err);
            }
        }
        this.forget();
    }

    private forget(): void {
        this.session = null;
        writeStorage(SESSION_KEY, null);
    }

    async request(path: string, init: RequestInit = {}): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set('Authorization', this.authorization());
        const res = await fetch(`${this.serverUrl}${path}`, { ...init, headers });
        if (res.status === 401 && this.session) {
            console.error('[jellyfin] Access token rejected (401); signing in again.');
            this.forget();
            this.onUnauthorized();
        }
        return res;
    }
}
