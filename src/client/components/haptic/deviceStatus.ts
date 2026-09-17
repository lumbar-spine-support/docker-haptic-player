import { channelKey, type HapticChannel } from '../../../shared/haptics';
import type { ConnectionState, ButtplugClientManager } from './buttplugClient';

type DeviceStatusValue = 'connected' | 'disconnected';

const STATUS_CLASSES: Record<DeviceStatusValue, string> = {
  connected: 'bg-success',
  disconnected: 'bg-secondary',
};

const STATUS_LABELS: Record<DeviceStatusValue, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
};

/**
 * Renders per-channel status badges in the player UI.
 *
 * A channel counts as connected only when at least one actuator of a connected
 * device is assigned to it, so an unassigned script shows as disconnected even
 * while Intiface itself is up.
 */
export class DeviceStatus {
  private readonly buttplug: ButtplugClientManager;
  private availableChannels: HapticChannel[] = [];

  constructor(buttplug: ButtplugClientManager) {
    this.buttplug = buttplug;

    buttplug.onStateChange((state) => this.handleConnectionState(state));
    buttplug.onDevicesChange(() => this.refresh());
    buttplug.onAssignmentsChange(() => this.refresh());

    this.refresh();
  }

  /** Call when the track changes to update which channels are available. */
  setAvailableChannels(channels: HapticChannel[]): void {
    this.availableChannels = channels;
    this.refresh();
  }

  private handleConnectionState(state: ConnectionState): void {
    const connEl = document.getElementById('intiface-status');
    if (!connEl) return;

    connEl.className = 'badge ' + (
      state === 'connected' ? 'bg-success' :
        state === 'connecting' ? 'bg-warning text-dark' :
          state === 'error' ? 'bg-danger' :
            'bg-secondary'
    );
    connEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);

    this.refresh();
  }

  /** Recomputes and redraws all visible channel status badges. */
  refresh(): void {
    const isConnected = this.buttplug.connectionState === 'connected';

    for (const channel of this.availableChannels) {
      const status: DeviceStatusValue =
        isConnected && this.buttplug.hasFeaturesFor(channel) ? 'connected' : 'disconnected';
      const key = channelKey(channel);
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-device-status="${key}"]`))) {
        el.className = 'badge ' + STATUS_CLASSES[status];
        el.textContent = STATUS_LABELS[status];
      }
    }
  }
}
