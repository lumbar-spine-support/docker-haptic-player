import type { HapticChannel } from '../../../shared/haptics';
import type {
  AssignmentListener,
  ChannelHealth,
  ConnectionState,
  DeviceAlert,
  DeviceBadge,
  DeviceFeature,
  DeviceListener,
  FeatureDetail,
  HapticBackend,
  HapticDevice,
  StateListener,
  StrokerRange,
} from './backend';
import { Emitter } from './emitter';

/**
 * Presents several haptic transports to the rest of the app as one.
 *
 * Every backend stays live simultaneously, so an Intiface toy and a DG-Lab Coyote
 * can follow the same funscript at once. Per-device operations are routed to the
 * backend that owns the device; channel operations fan out to all of them.
 */
export class HapticBackendRegistry implements HapticBackend {
  private readonly backends: HapticBackend[] = [];
  private readonly stateChanged = new Emitter<ConnectionState>();
  private readonly devicesChanged = new Emitter<HapticDevice[]>();
  private readonly assignmentsChanged = new Emitter<ReadonlyMap<string, string>>();
  private readonly deviceStateChanged = new Emitter();

  add(backend: HapticBackend): void {
    this.backends.push(backend);
    backend.onStateChange(() => this.stateChanged.emit(this.connectionState));
    backend.onDevicesChange(() => this.devicesChanged.emit(this.devices));
    backend.onAssignmentsChange(() => this.emitAssignments());
    backend.onDeviceStateChange?.(() => this.deviceStateChanged.emit());
  }

  onStateChange(listener: StateListener): void { this.stateChanged.on(listener); }
  onDevicesChange(listener: DeviceListener): void { this.devicesChanged.on(listener); }
  onAssignmentsChange(listener: AssignmentListener): void { this.assignmentsChanged.on(listener); }
  onDeviceStateChange(listener: () => void): void { this.deviceStateChanged.on(listener); }

  /** Connected as soon as any backend is; the UI then keys off per-channel assignment. */
  get connectionState(): ConnectionState {
    const states = this.backends.map((b) => b.connectionState);
    if (states.includes('connected')) return 'connected';
    if (states.includes('connecting')) return 'connecting';
    if (states.includes('error')) return 'error';
    return 'disconnected';
  }

  get devices(): HapticDevice[] {
    return this.backends.flatMap((b) => b.devices);
  }

  getFeatures(device: HapticDevice): DeviceFeature[] {
    return this.ownerOf(device)?.getFeatures(device) ?? [];
  }

  getBatteryLevel(device: HapticDevice): Promise<number | null> {
    return this.ownerOf(device)?.getBatteryLevel(device) ?? Promise.resolve(null);
  }

  getCarrierFrequency(deviceName: string): number | null {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    return owner?.getCarrierFrequency?.(deviceName) ?? null;
  }

  setCarrierFrequency(deviceName: string, frequency: number): void {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    owner?.setCarrierFrequency?.(deviceName, frequency);
  }

  getPulseWidth(deviceName: string): number | null {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    return owner?.getPulseWidth?.(deviceName) ?? null;
  }

  setPulseWidth(deviceName: string, width: number): void {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    owner?.setPulseWidth?.(deviceName, width);
  }

  getStrokerRange(deviceName: string): StrokerRange | null {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    return owner?.getStrokerRange?.(deviceName) ?? null;
  }

  setStrokerRange(deviceName: string, range: StrokerRange): void {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    owner?.setStrokerRange?.(deviceName, range);
  }

  getDeviceBadge(deviceName: string): DeviceBadge | null {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    return owner?.getDeviceBadge?.(deviceName) ?? null;
  }

  getDeviceAlerts(deviceName: string): DeviceAlert[] {
    const owner = this.backends.find((b) => b.devices.some((d) => d.name === deviceName));
    return owner?.getDeviceAlerts?.(deviceName) ?? [];
  }

  getFeatureDetails(featureId: string): FeatureDetail[] {
    return this.ownerOfFeature(featureId)?.getFeatureDetails?.(featureId) ?? [];
  }

  setFeatureChannel(featureId: string, channel: HapticChannel | null): void {
    const owner = this.ownerOfFeature(featureId);
    if (owner) owner.setFeatureChannel(featureId, channel);
    else for (const backend of this.backends) backend.setFeatureChannel(featureId, channel);
  }

  getFeatureChannel(featureId: string): string | null {
    for (const backend of this.backends) {
      const channel = backend.getFeatureChannel(featureId);
      if (channel !== null) return channel;
    }
    return null;
  }

  getDeviceStrength(deviceName: string): number {
    for (const backend of this.backends) {
      if (backend.devices.some((d) => d.name === deviceName)) return backend.getDeviceStrength(deviceName);
    }
    return 1;
  }

  setDeviceStrength(deviceName: string, strength: number): void {
    for (const backend of this.backends) {
      if (backend.devices.some((d) => d.name === deviceName)) backend.setDeviceStrength(deviceName, strength);
    }
  }

  hasFeaturesFor(channel: HapticChannel): boolean {
    return this.backends.some((b) => b.hasFeaturesFor(channel));
  }

  hasLinearFor(channel: HapticChannel): boolean {
    return this.backends.some((b) => b.hasLinearFor(channel));
  }

  getChannelHealth(channel: HapticChannel): ChannelHealth {
    const total: ChannelHealth = { total: 0, usable: 0, alerts: [] };
    for (const backend of this.backends) {
      if (backend.connectionState !== 'connected') continue;
      const health = backend.getChannelHealth?.(channel)
        ?? (backend.hasFeaturesFor(channel) ? { total: 1, usable: 1, alerts: [] } : null);
      if (!health) continue;
      total.total += health.total;
      total.usable += health.usable;
      total.alerts.push(...health.alerts);
    }
    return total;
  }

  sendContinuous(channel: HapticChannel, intensity: number, lookahead?: (offsetMs: number) => number | null): void {
    for (const backend of this.backends) {
      if (backend.hasFeaturesFor(channel)) backend.sendContinuous(channel, intensity, lookahead);
    }
  }

  sendLinear(channel: HapticChannel, position: number, durationMs: number): void {
    for (const backend of this.backends) {
      if (backend.hasLinearFor(channel)) backend.sendLinear(channel, position, durationMs);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.backends.map((b) => b.stopAll()));
  }

  private ownerOf(device: HapticDevice): HapticBackend | undefined {
    // Compared by name, not identity: backends are free to hand out fresh wrappers.
    return this.backends.find((b) => b.devices.some((d) => d.name === device.name));
  }

  private ownerOfFeature(featureId: string): HapticBackend | undefined {
    return this.backends.find((b) => b.devices.some((d) => b.getFeatures(d).some((f) => f.id === featureId)));
  }

  private emitAssignments(): void {
    const merged = new Map<string, string>();
    for (const backend of this.backends) {
      for (const device of backend.devices) {
        for (const feature of backend.getFeatures(device)) {
          const channel = backend.getFeatureChannel(feature.id);
          if (channel) merged.set(feature.id, channel);
        }
      }
    }
    this.assignmentsChanged.emit(merged);
  }
}
