import type { JellyfinAuthResult } from './dto';
import type { JellyfinApi } from './library';
import type { JellyfinEndpoint } from './urls';

const SESSION_KEY = 'happy-jellyfin-session';
const DEVICE_ID_KEY = 'happy-jellyfin-device-id';

interface StoredSession {
    serverUrl: string;
    token: string;
    userId: string;
    userName: string;
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

/** Jellyfin lists every sign-in under Dashboard → Devices; a stable id keeps that to one entry per browser. */
/**
 * A random device id. `crypto.randomUUID` only exists in secure contexts, and Jellyfin (which serves
 * HAPPY) is often reached over plain HTTP on a LAN address; `getRandomValues` works everywhere.
 */
export function randomDeviceId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

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

    /** Ends the session on the server too, so the device entry disappears from Jellyfin's dashboard. */
    async signOut(): Promise<void> {
        if (this.session) {
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
