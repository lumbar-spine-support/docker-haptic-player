// Login page controller. Bundled separately from the app so no application code
// is served to unauthenticated clients.

interface AuthStatus {
    required: boolean;
    authenticated: boolean;
}

const RETRY_AFTER_FALLBACK_S = 60;

// The login page lives one level deep, so the app root is the parent of this directory.
const BASE = new URL('..', window.location.href).pathname;

function el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

// Only same-origin relative paths are accepted, otherwise this is an open redirect.
function safeReturnTo(): string {
    const raw = new URLSearchParams(window.location.search).get('returnTo');
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return BASE;
    return raw;
}

function main(): void {
    const form = el<HTMLFormElement>('login-form');
    const input = el<HTMLInputElement>('password');
    const submit = el<HTMLButtonElement>('login-submit');
    const errorBox = el<HTMLElement>('login-error');
    if (!form || !input || !submit || !errorBox) return;

    const showError = (message: string): void => {
        errorBox.textContent = message;
        errorBox.classList.remove('d-none');
    };

    const clearError = (): void => {
        errorBox.textContent = '';
        errorBox.classList.add('d-none');
    };

    const enter = (): void => {
        window.location.replace(safeReturnTo());
    };

    const lockFor = (seconds: number): void => {
        let remaining = seconds;
        submit.disabled = true;
        const tick = window.setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                window.clearInterval(tick);
                submit.disabled = false;
                clearError();
                return;
            }
            showError(`Too many attempts. Try again in ${remaining} seconds.`);
        }, 1000);
    };

    const skipIfSignedIn = async (): Promise<void> => {
        try {
            const res = await fetch(`${BASE}api/auth/status`);
            if (!res.ok) return;
            const status = (await res.json()) as AuthStatus;
            if (status.authenticated) enter();
        } catch {
            // The form below is the fallback.
        }
    };

    const signIn = async (): Promise<void> => {
        clearError();
        submit.disabled = true;

        let res: Response;
        try {
            res = await fetch(`${BASE}api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: input.value }),
            });
        } catch (err) {
            submit.disabled = false;
            console.error('[auth] Login request failed', err);
            showError('Could not reach the server.');
            return;
        }

        if (res.ok) {
            enter();
            return;
        }

        submit.disabled = false;
        input.select();

        if (res.status === 401) {
            console.error('[auth] Login failed: invalid password');
            showError('Invalid password.');
            return;
        }

        if (res.status === 429) {
            const retryAfter = Number(res.headers.get('Retry-After')) || RETRY_AFTER_FALLBACK_S;
            console.error(`[auth] Login throttled, retry in ${retryAfter}s`);
            showError(`Too many attempts. Try again in ${retryAfter} seconds.`);
            lockFor(retryAfter);
            return;
        }

        console.error(`[auth] Login failed with status ${res.status}`);
        showError(`Sign in failed (${res.status}).`);
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        void signIn();
    });

    void skipIfSignedIn();
}

document.addEventListener('DOMContentLoaded', main);
