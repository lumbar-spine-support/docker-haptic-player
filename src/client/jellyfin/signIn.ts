import signInTemplate from './signIn.html';
import { renderTemplate } from '../utils/template';
import type { JellyfinConnection } from './connection';

/**
 * Shows the Jellyfin sign-in card over the app and resolves once the connection holds a valid
 * session. Resolves immediately when already signed in.
 */
export function ensureSignedIn(connection: JellyfinConnection): Promise<void> {
    if (connection.signedIn) return Promise.resolve();

    const host = document.createElement('div');
    host.innerHTML = renderTemplate(signInTemplate, { server: connection.serverUrl });
    const overlay = host.firstElementChild as HTMLElement;
    document.body.append(overlay);

    const form = overlay.querySelector<HTMLFormElement>('#jellyfin-sign-in-form');
    const user = overlay.querySelector<HTMLInputElement>('#jellyfin-user');
    const password = overlay.querySelector<HTMLInputElement>('#jellyfin-password');
    const submit = overlay.querySelector<HTMLButtonElement>('#jellyfin-sign-in-submit');
    const error = overlay.querySelector<HTMLElement>('#jellyfin-sign-in-error');
    user?.focus();

    return new Promise((resolve) => {
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!user?.value.trim()) {
                user?.focus();
                return;
            }
            if (submit) submit.disabled = true;
            error?.classList.add('d-none');
            try {
                await connection.signIn(user.value.trim(), password?.value ?? '');
                overlay.remove();
                resolve();
            } catch (err) {
                if (error) {
                    error.textContent = err instanceof Error ? err.message : 'Sign-in failed.';
                    error.classList.remove('d-none');
                }
                password?.select();
            } finally {
                if (submit) submit.disabled = false;
            }
        });
    });
}

/** Shows a blocking notice when HAPPY has no Jellyfin server configured. */
export function showMissingServerNotice(): void {
    const notice = document.createElement('div');
    notice.className = 'jellyfin-sign-in';
    notice.innerHTML = `<main class="login-card"><div class="card bg-dark border-secondary shadow"><div class="card-body p-4">
        <h1 class="h5 fw-bold mb-3">Open HAPPY from Jellyfin</h1>
        <p class="mb-0 small">HAPPY is served by its Jellyfin plugin. Open <code>&lt;your Jellyfin address&gt;/Happy/Web/</code>, or <em>Open HAPPY</em> on the plugin's settings page.</p>
    </div></div></main>`;
    document.body.append(notice);
}
