/**
 * Shared login for integration tests against a real Jellyfin server.
 *
 * Connection details come only from the environment (see `config/test.env`, which is gitignored),
 * so no server address or credential ever lands in the repository. Tests must assert shapes and
 * invariants, never library contents, and must not print names, paths or URLs.
 */
const { HAPPY_JELLYFIN_URL, HAPPY_JELLYFIN_USER, HAPPY_JELLYFIN_PASSWORD } = process.env;

/** Reason to skip, or `false` when a server is configured. Pass as `test(name, { skip }, fn)`. */
export const skip: string | false =
    HAPPY_JELLYFIN_URL && HAPPY_JELLYFIN_USER ? false : 'HAPPY_JELLYFIN_URL / HAPPY_JELLYFIN_USER not set';

export interface JellyfinSession {
    userId: string;
    token: string;
    /** Fetch a server path, authenticated unless `anonymous` is set. */
    request(path: string, init?: RequestInit & { anonymous?: boolean }): Promise<Response>;
    logout(): Promise<void>;
}

function authorization(device: string, token?: string): string {
    const base = `MediaBrowser Client="HAPPY", Device="integration-tests", DeviceId="happy-integration-tests-${device}", Version="0.0.0"`;
    return token ? `${base}, Token="${token}"` : base;
}

/**
 * Signs in as the test user. Jellyfin revokes a device's previous token when it signs in again,
 * so every test file that runs in parallel needs its own `device` name.
 */
export async function login(device: string): Promise<JellyfinSession> {
    const base = String(HAPPY_JELLYFIN_URL).replace(/\/+$/, '');
    const res = await fetch(`${base}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization(device) },
        body: JSON.stringify({ Username: HAPPY_JELLYFIN_USER, Pw: HAPPY_JELLYFIN_PASSWORD ?? '' }),
    });
    if (!res.ok) throw new Error(`Jellyfin login failed with HTTP ${res.status}`);
    const { AccessToken: token, User } = (await res.json()) as { AccessToken: string; User: { Id: string } };

    const request: JellyfinSession['request'] = (path, { anonymous, headers, ...init } = {}) =>
        fetch(`${base}${path}`, {
            ...init,
            headers: { ...(anonymous ? {} : { Authorization: authorization(device, token) }), ...headers },
        });

    return {
        userId: User.Id,
        token,
        request,
        async logout() {
            await request('/Sessions/Logout', { method: 'POST' });
        },
    };
}
