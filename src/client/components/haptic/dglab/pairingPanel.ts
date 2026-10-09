import { DGLAB_DETACH_GRACE_MS } from '../../../../shared/dglab';
import { storedSetting } from '../../../utils/storedSetting';
import type { CoyoteBackend } from './coyoteBackend';
import { pairingDeepLink, pairingQR } from './v4/pairing';

const lastState = storedSetting('happy-dglab-last-state', 'disconnected');
const lastSeen = storedSetting('happy-dglab-last-seen', 0);

/** DG-Lab status badge, read-only relay address, connect controls and QR code, plus the optional auto-reconnect. */
export function bindPairingPanel(coyote: CoyoteBackend, autoReconnect: boolean): void {
    const statusEl = document.getElementById('dglab-status');
    const connectBtn = document.getElementById('btn-dglab-connect') as HTMLButtonElement | null;
    const disconnectBtn = document.getElementById('btn-dglab-disconnect') as HTMLButtonElement | null;
    const pairingEl = document.getElementById('dglab-pairing');
    const linkEl = document.getElementById('dglab-pair-link') as HTMLAnchorElement | null;
    const relayEl = document.getElementById('dglab-relay') as HTMLInputElement | null;
    const relayHint = document.getElementById('dglab-relay-hint');
    const hostGroup = document.getElementById('dglab-host-group');
    const urlGroup = document.getElementById('dglab-url-group');
    const urlEl = document.getElementById('dglab-url') as HTMLInputElement | null;
    const qrEl = document.getElementById('dglab-pair-qr') as HTMLImageElement | null;
    let qrUrl: string | null = null;

    const sync = (): void => {
        const state = coyote.connectionState;
        const paired = coyote.appCount > 0;
        if (statusEl) {
            statusEl.className = 'badge ' + (
                paired ? 'bg-success' :
                    state === 'connected' ? 'bg-warning text-dark' :
                        state === 'connecting' ? 'bg-warning text-dark' :
                            state === 'error' ? 'bg-danger' : 'bg-secondary'
            );
            statusEl.textContent = paired ? 'Paired' : state === 'connected' ? 'Waiting for app' : state.charAt(0).toUpperCase() + state.slice(1);
        }
        const on = state === 'connected' || state === 'connecting';
        hostGroup?.classList.toggle('d-none', on);
        urlGroup?.classList.toggle('d-none', !on);
        const url = coyote.pairingUrl;
        if (urlEl) urlEl.value = url ?? '';
        pairingEl?.classList.toggle('d-none', !url || paired);

        if (url && linkEl) {
            linkEl.href = pairingDeepLink(url);
        }

        const renderQr = url && !paired && qrEl && url !== qrUrl;
        if (renderQr) {
            qrUrl = url;
            const updateUrl = (data: string) => { if (qrUrl === url) qrEl.src = data; };
            pairingQR(url, updateUrl);
        }
        relayHint?.classList.toggle('d-none', on || !coyote.relayIsLoopback);
    };

    coyote.onStateChange((state) => {
        if (state === 'connected') {
            lastState.set('connected');
            lastSeen.set(Date.now());
        }
        sync();
    });
    coyote.onDevicesChange(() => sync());
    coyote.onActivity((at) => lastSeen.set(at));
    window.addEventListener('pagehide', () => {
        if (coyote.connectionState === 'connected') lastSeen.set(Date.now());
    });

    connectBtn?.addEventListener('click', () => {
        coyote.connect();
        sync();
    });

    disconnectBtn?.addEventListener('click', () => {
        lastState.set('disconnected');
        coyote.disconnect();
        sync();
    });

    urlEl?.addEventListener('focus', () => urlEl.select());

    if (relayEl) relayEl.value = coyote.relayAddress;
    relayEl?.addEventListener('focus', () => relayEl.select());

    sync();

    // Past the grace period the relay has dropped the app, so pairing must start over by hand.
    const withinGrace = Date.now() - lastSeen.get() < DGLAB_DETACH_GRACE_MS;
    if (autoReconnect && lastState.get() === 'connected' && withinGrace) {
        coyote.connect();
        sync();
    }
}
