import { channelKey, type HapticChannel } from '../../../shared/haptics';
import type { ChannelHealth, HapticBackend } from './backend';

export type DeviceStatusValue = 'connected' | 'warning' | 'error' | 'disconnected';

const STATUS_CLASSES: Record<DeviceStatusValue, string> = {
  connected: 'bg-success',
  warning: 'bg-warning text-dark',
  error: 'bg-danger',
  disconnected: 'bg-secondary',
};

export interface ChannelStatusView {
  status: DeviceStatusValue;
  label: string;
  description: string;
}

/** Badge state and popover text for one channel. */
export function describeChannel(health: ChannelHealth): ChannelStatusView {
  const messages = [...new Set(health.alerts.map((a) => a.message))];
  if (health.total === 0) {
    return {
      status: 'disconnected',
      label: 'Disconnected',
      description: 'No connected device is assigned to this script. Assign one in the settings.',
    };
  }
  if (health.usable === 0) {
    return {
      status: 'error',
      label: 'Error',
      description: messages.join('\n'),
    };
  }
  if (messages.length > 0) {
    return {
      status: 'warning',
      label: 'Warning',
      description: messages.join('\n'),
    };
  }
  return {
    status: 'connected',
    label: 'Connected',
    description: health.usable === 1
      ? 'Playing on 1 assigned output.'
      : `Playing on ${health.usable} assigned outputs.`,
  };
}

/**
 * Renders per-channel status badges in the player UI.
 *
 * A channel counts as connected only when at least one usable actuator is
 * assigned to it. Clicking a badge opens a popover explaining its state.
 */
export class DeviceStatus {
  private readonly buttplug: HapticBackend;
  private availableChannels: HapticChannel[] = [];
  /** Popover text last applied per badge, so an open popover is only redrawn on real changes. */
  private readonly popovers = new Map<HTMLElement, string>();

  constructor(buttplug: HapticBackend) {
    this.buttplug = buttplug;

    buttplug.onStateChange(() => this.refresh());
    buttplug.onDevicesChange(() => this.refresh());
    buttplug.onAssignmentsChange(() => this.refresh());
    buttplug.onDeviceStateChange?.(() => this.refresh());

    this.refresh();
  }

  /** Call when the track changes to update which channels are available. */
  setAvailableChannels(channels: HapticChannel[]): void {
    this.availableChannels = channels;
    this.refresh();
  }

  /** Recomputes and redraws all visible channel status badges. */
  refresh(): void {
    this.disposeDetached();

    for (const channel of this.availableChannels) {
      const view = describeChannel(this.healthOf(channel));
      const key = channelKey(channel);
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-device-status="${key}"]`))) {
        el.className = `badge device-status-badge ${STATUS_CLASSES[view.status]}`;
        el.textContent = view.label;
        this.updatePopover(el, view);
      }
    }
  }

  private healthOf(channel: HapticChannel): ChannelHealth {
    if (this.buttplug.connectionState !== 'connected') return { total: 0, usable: 0, alerts: [] };
    if (this.buttplug.getChannelHealth) return this.buttplug.getChannelHealth(channel);
    const assigned = this.buttplug.hasFeaturesFor(channel) ? 1 : 0;
    return { total: assigned, usable: assigned, alerts: [] };
  }

  private updatePopover(el: HTMLElement, view: ChannelStatusView): void {
    const Popover = window.bootstrap?.Popover;
    if (!Popover) return;
    const text = `${view.label}\n${view.description}`;
    if (this.popovers.get(el) === text) return;

    const existing = Popover.getInstance(el);
    if (existing) {
      existing.setContent({ '.popover-header': view.label, '.popover-body': view.description });
    } else {
      // Focus trigger is Bootstrap's "dismiss on next click" pattern.
      Popover.getOrCreateInstance(el, {
        trigger: 'focus',
        placement: 'left',
        title: view.label,
        content: view.description,
        customClass: 'device-status-popover',
      });
    }
    this.popovers.set(el, text);
  }

  /** Script rows are rebuilt per track; drop popovers whose badge is gone so none stays open. */
  private disposeDetached(): void {
    for (const el of this.popovers.keys()) {
      if (el.isConnected) continue;
      window.bootstrap?.Popover.getInstance(el)?.dispose();
      this.popovers.delete(el);
    }
  }
}
