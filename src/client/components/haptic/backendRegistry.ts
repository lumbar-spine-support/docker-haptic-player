import type { HapticChannel } from '../../../shared/haptics';
import type {
  AssignmentListener,
  ConnectionState,
  DeviceAlert,
  DeviceBadge,
  DeviceFeature,
  DeviceListener,
  FeatureDetail,
  HapticBackend,
  HapticDevice,
  StateListener,
} from './backend';

/**
 * Presents several haptic transports to the rest of the app as one.
 *
 * Every backend stays live simultaneously, so an Intiface toy and a DG-Lab Coyote
 * can follow the same funscript at once. Per-device operations are routed to the
 * backend that owns the device; channel operations fan out to all of them.
 */
export class HapticBackendRegistry implements HapticBackend {
  private readonly backends: HapticBackend[] = [];
  private readonly stateListeners: StateListener[] = [];
  private readonly deviceListeners: DeviceListener[] = [];
  private readonly assignmentListeners: AssignmentListener[] = [];
  private readonly deviceStateListeners: Array<() => void> = [];

  private strength = 1.0;
  private rangeMin = 0;
  private rangeMax = 1;

  add(backend: HapticBackend): void {
    this.backends.push(backend);
    if (this.backends.length === 1) {
      this.rangeMin = backend.linearRangeMin;
      this.rangeMax = backend.linearRangeMax;
    }
    backend.masterStrength = this.strength;
    backend.onStateChange(() => this.emitState());
    backend.onDevicesChange(() => this.emitDevices());
    backend.onAssignmentsChange(() => this.emitAssignments());
    backend.onDeviceStateChange?.(() => {
      for (const l of this.deviceStateListeners) l();
    });
  }

  onStateChange(listener: StateListener): void { this.stateListeners.push(listener); }
  onDevicesChange(listener: DeviceListener): void { this.deviceListeners.push(listener); }
  onAssignmentsChange(listener: AssignmentListener): void { this.assignmentListeners.push(listener); }
  onDeviceStateChange(listener: () => void): void { this.deviceStateListeners.push(listener); }

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

  get masterStrength(): number { return this.strength; }
  set masterStrength(value: number) {
    this.strength = value;
    for (const backend of this.backends) backend.masterStrength = value;
  }

  get linearRangeMin(): number { return this.rangeMin; }
  get linearRangeMax(): number { return this.rangeMax; }

  setLinearRange(min: number, max: number): void {
    this.rangeMin = min;
    this.rangeMax = max;
    for (const backend of this.backends) backend.setLinearRange(min, max);
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

  sendContinuous(channel: HapticChannel, intensity: number): void {
    for (const backend of this.backends) {
      if (backend.hasFeaturesFor(channel)) backend.sendContinuous(channel, intensity);
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

  private emitState(): void {
    const state = this.connectionState;
    for (const l of this.stateListeners) l(state);
  }

  private emitDevices(): void {
    const devices = this.devices;
    for (const l of this.deviceListeners) l(devices);
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
    for (const l of this.assignmentListeners) l(merged);
  }
}
