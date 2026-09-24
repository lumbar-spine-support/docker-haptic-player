import type { HapticChannel } from '../../../shared/haptics';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** How a single actuator is addressed on the wire. */
export type FeatureKind = 'scalar' | 'rotate' | 'linear' | 'estim';

/** Minimal shape the UI needs from a device, whatever backend owns it. */
export interface HapticDevice {
  readonly name: string;
}

/** One individually addressable actuator of a device. */
export interface DeviceFeature {
  /** Stable identity across reconnects: device name + actuator kind + actuator index. */
  id: string;
  deviceName: string;
  kind: FeatureKind;
  /** Actuator index inside the device. */
  index: number;
  /** Device-reported descriptor, e.g. "Vibrator" or "Channel A". */
  descriptor: string;
  label: string;
}

export type StateListener = (state: ConnectionState) => void;
export type DeviceListener = (devices: HapticDevice[]) => void;
export type AssignmentListener = (assignments: ReadonlyMap<string, string>) => void;

/**
 * Everything the sync engine and the settings UI need from a haptic transport.
 *
 * Implemented by `ButtplugClientManager` (Intiface) and `CoyoteBackend` (DG-Lab),
 * and by `HapticBackendRegistry`, which fans out across both at once.
 */
export interface HapticBackend {
  onStateChange(listener: StateListener): void;
  onDevicesChange(listener: DeviceListener): void;
  onAssignmentsChange(listener: AssignmentListener): void;

  readonly connectionState: ConnectionState;
  readonly devices: HapticDevice[];

  getFeatures(device: HapticDevice): DeviceFeature[];
  setFeatureChannel(featureId: string, channel: HapticChannel | null): void;
  getFeatureChannel(featureId: string): string | null;

  getDeviceStrength(deviceName: string): number;
  setDeviceStrength(deviceName: string, strength: number): void;

  hasFeaturesFor(channel: HapticChannel): boolean;
  hasLinearFor(channel: HapticChannel): boolean;

  sendContinuous(channel: HapticChannel, intensity: number): void;
  sendLinear(channel: HapticChannel, position: number, durationMs: number): void;

  getBatteryLevel(device: HapticDevice): Promise<number | null>;
  stopAll(): Promise<void>;

  /**
   * Optional: carrier frequency of a pulse-based device, 1–100.
   *
   * Returns null for devices that have no carrier, which is how the settings UI
   * decides whether to show the control.
   */
  getCarrierFrequency?(deviceName: string): number | null;
  setCarrierFrequency?(deviceName: string, frequency: number): void;

  /** Master strength multiplier 0–1 applied to continuous output. */
  masterStrength: number;
  /** Min/max output range (0–1) that linear (stroker) positions are rescaled into. */
  readonly linearRangeMin: number;
  readonly linearRangeMax: number;
  setLinearRange(min: number, max: number): void;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
