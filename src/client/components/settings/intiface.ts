import type { ButtplugClientManager } from '../haptic/buttplugClient';
import type { DeviceAlert } from '../haptic/backend';
import { deviceAlertHtml } from '../haptic/templates';
import { qs } from '../../utils/html';
import { storedSetting } from '../../utils/storedSetting';
import { DEFAULT_INTIFACE_ADDRESS, formatIntifaceAddress, parseIntifaceAddress, type IntifaceAddress, type WsScheme } from '../../utils/intifaceAddress';

const address = storedSetting('happy-intiface-address', formatIntifaceAddress(DEFAULT_INTIFACE_ADDRESS));
const lastState = storedSetting('happy-intiface-last-state', 'disconnected');

/** Intiface address field, connect button and status, plus the optional auto-reconnect. */
export function bindIntifaceSettings(buttplug: ButtplugClientManager, autoReconnect: boolean): void {
    const connectBtn = qs<HTMLButtonElement>('#btn-connect');
    const resetBtn = qs<HTMLButtonElement>('#btn-reset');
    const schemeSelect = qs<HTMLSelectElement>('#intiface-scheme');
    const input = qs<HTMLInputElement>('#intiface-address');
    const statusEl = qs<HTMLElement>('#intiface-status');
    const alertsEl = qs<HTMLElement>('#intiface-alerts');

    const show = (value: IntifaceAddress): void => {
        if (schemeSelect) schemeSelect.value = value.scheme;
        if (input) input.value = value.host;
    };
    /** Parse the fields, write the normalized value back and persist it. */
    const commit = (): string => {
        const scheme = (schemeSelect?.value as WsScheme | undefined) ?? DEFAULT_INTIFACE_ADDRESS.scheme;
        const parsed = parseIntifaceAddress(input?.value ?? '', scheme);
        show(parsed);
        const url = formatIntifaceAddress(parsed);
        address.set(url);
        return url;
    };

    const saved = parseIntifaceAddress(address.get());
    show(saved);

    const syncConnectionButton = (): void => {
        const state = buttplug.connectionState;
        if (statusEl) {
            statusEl.className = 'badge ' + (
                state === 'connected' ? 'bg-success' :
                    state === 'connecting' ? 'bg-warning text-dark' :
                        state === 'error' ? 'bg-danger' :
                            'bg-secondary'
            );
            statusEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);
        }
        if (!connectBtn) return;
        connectBtn.disabled = state === 'connecting';
        connectBtn.classList.remove('btn-outline-primary', 'btn-outline-danger', 'btn-outline-secondary');
        if (state === 'connected') {
            connectBtn.textContent = 'Disconnect';
            connectBtn.classList.add('btn-outline-danger');
        } else if (state === 'connecting') {
            connectBtn.textContent = 'Connecting…';
            connectBtn.classList.add('btn-outline-secondary');
        } else {
            connectBtn.textContent = 'Connect';
            connectBtn.classList.add('btn-outline-primary');
        }
    };

    resetBtn?.addEventListener('click', () => {
        show(DEFAULT_INTIFACE_ADDRESS);
        commit();
    });
    input?.addEventListener('change', () => commit());
    schemeSelect?.addEventListener('change', () => commit());
    connectBtn?.addEventListener('click', () => {
        if (buttplug.connectionState === 'connected') {
            lastState.set('disconnected');
            void buttplug.disconnect();
            return;
        }
        void buttplug.connect(commit());
    });
    const syncAlerts = (): void => {
        if (!alertsEl) return;
        const state = buttplug.connectionState;
        const alerts: DeviceAlert[] = [];
        if (state === 'error') {
            alerts.push({ level: 'danger', message: 'Could not connect to Intiface WebSocket. Check if host:port are correct and the server is running.' });
        } else if (state === 'connected' && buttplug.devices.length === 0) {
            alerts.push({ level: 'warning', message: 'No devices paired with Intiface Server.' });
        }
        alertsEl.innerHTML = alerts.map(deviceAlertHtml).join('');
    };
    buttplug.onStateChange((state) => {
        if (state === 'connected') lastState.set('connected');
        syncConnectionButton();
        syncAlerts();
    });
    buttplug.onDevicesChange(() => syncAlerts());
    syncConnectionButton();
    syncAlerts();

    if (autoReconnect && lastState.get() === 'connected') {
        const failSilently = true; // Initial connection attempt should fail silently
        void buttplug.connect(formatIntifaceAddress(saved), failSilently);
    }
}
