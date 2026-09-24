import { channelKey, type HapticChannel } from '../../../../shared/haptics';
import {
  clamp01,
  type AssignmentListener,
  type ConnectionState,
  type DeviceAlert,
  type DeviceBadge,
  type DeviceFeature,
  type DeviceListener,
  type FeatureDetail,
  type HapticBackend,
  type HapticDevice,
  type StateListener,
} from '../backend';
import {
  V4Channel,
  buildAppendPulseData,
  buildClear,
  buildResetIntensity,
  buildSetTempIntensity,
  type V4ChannelId,
  type V4Device,
} from './protocol';
import { DEFAULT_PULSE_FREQUENCY, FRAME_DURATION_MS, carrierFrames, clampFrequency } from './waveform';
import { DglabV4Socket } from './socket';

const ASSIGNMENTS_KEY = 'happy-dglab-assignments';
const STRENGTHS_KEY = 'happy-dglab-strengths';
const FREQUENCY_KEY = 'happy-dglab-frequency';
const PAIRING_HOST_KEY = 'happy-dglab-pairing-host';

/** Feature ids are namespaced so they never collide with Buttplug ids. */
const FEATURE_PREFIX = 'dglab';

/**
 * How long a strength task stays alive. Longer than the refresh interval so output
 * never gaps, short enough to act as a dead-man's switch when the tab or the
 * network dies.
 */
const STRENGTH_DURATION_MS = 300;

/**
 * Strength resend interval. `FunscriptSync` ticks far faster than this, but the
 * device only consumes one tick per ~100 ms, so sending more often just floods
 * the relay.
 */
const STRENGTH_INTERVAL_MS = 100;

/** Carrier batch size and how often it is refreshed. */
const CARRIER_FRAME_COUNT = 10;
const CARRIER_INTERVAL_MS = 800;

/** Channel status values that mean "do not drive this channel". */
const STATUS_NO_CIRCUIT = 1;
const STATUS_DAMAGED = 3;
const STATUS_MASKED = 4;

/**
 * Full-scale strength of a Coyote channel.
 *
 * The app shows limits against this scale but never reports it, so it is fixed
 * here to give `intensityMax` a denominator.
 */
const ABSOLUTE_SCALE = 200;

/** Slot marker colours the app uses; anything else is ignored rather than injected as CSS. */
const MARK_LIGHT_COLORS: Record<string, string> = {
  yellow: '#ffc107',
  green: '#198754',
  red: '#dc3545',
  purple: '#a855f7',
  blue: '#0d6efd',
  cyan: '#0dcaf0',
};

interface CoyoteChannelRef {
  device: V4Device;
  channel: V4ChannelId;
}

/** Device type string reported by a Coyote 3.0. */
export function isCoyote(type: string): boolean {
  // Matched loosely: the exact casing of the reported type is not guaranteed, and
  // `unknown` means our own parser could not find the field at all.
  return /coyote/i.test(type) || type === 'unknown';
}

/** Display names for device types reported by the app, keyed case-insensitively. */
const KNOWN_DEVICE_NAMES: Record<string, string> = {
  COYOTE_030: 'Coyote 3.0',
};

/** Human-readable model name, falling back to the raw reported type. */
export function deviceModelName(type: string): string {
  return KNOWN_DEVICE_NAMES[type.toUpperCase()] ?? (type && type !== 'unknown' ? type : 'Coyote');
}

/** Devices are surfaced to the UI under a stable display name per slot. */
function deviceName(device: V4Device): string {
  return `${deviceModelName(device.type)} (${device.id.slice(0, 6)})`;
}

function featureId(device: V4Device, channel: V4ChannelId): string {
  return `${FEATURE_PREFIX}#${device.id}#${channel}`;
}

function channelState(device: V4Device, channel: V4ChannelId) {
  return channel === V4Channel.A ? device.slotState?.channelA : device.slotState?.channelB;
}

function channelStatus(device: V4Device, channel: V4ChannelId): number | undefined {
  const raw = channel === V4Channel.A ? device.props?.channelAStatus : device.props?.channelBStatus;
  return typeof raw === 'number' ? raw : undefined;
}

/**
 * Highest strength this channel may be driven at.
 *
 * `intensityMax` is the app's own computed ceiling, derived from the comfort
 * limit settings and enforced app-side. `comfortMax` is one of its inputs, so
 * clamping to that as well would double-apply it and ignore a raised limit.
 */
export function channelCeiling(device: V4Device, channel: V4ChannelId): number {
  const max = channelState(device, channel)?.intensityMax;
  return typeof max === 'number' && max > 0 ? max : 0;
}

/** A muted channel accepts commands but emits nothing, which looks like a bug from the UI. */
export function isChannelMuted(device: V4Device, channel: V4ChannelId): boolean {
  return channelState(device, channel)?.isMuted === true;
}

/** Comfort limit mode the app is running in, e.g. `simple`. */
export function channelMode(device: V4Device, channel: V4ChannelId): string {
  const mode = channelState(device, channel)?.comfortLimit?.mode;
  return typeof mode === 'string' ? mode : 'unknown';
}

/** False while the slot exists in the app but no hardware is attached to it. */
export function isSlotConnected(device: V4Device): boolean {
  return device.slotState?.hasDevice !== false;
}

/**
 * Map a funscript position to an absolute channel strength.
 *
 * Exported as a free function so the mapping can be tested without a socket.
 */
export function mapIntensity(position: number, strength: number, ceiling: number): number {
  return Math.round(clamp01(position) * clamp01(strength) * Math.max(0, ceiling));
}

/** Hosts that are meaningless to a second device on the network. */
export function isLoopbackHost(host: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(`ws://${host}`).hostname;
  } catch {
    return false;
  }
  const name = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

/** Reduce user input to a bare `host[:port]`, since that is all the URL needs. */
export function normalizeHost(raw: string): string {
  return raw.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
}

/**
 * DG-Lab Coyote 3.0 backend, driven through the self-hosted V4 relay.
 *
 * The DG-Lab app owns every safety limit; this backend only ever asks for a value
 * at or below the limits the app reports. Channel strength is held at the user's
 * chosen volume and the funscript is played through the pulse waveform, which has
 * four times the time resolution of a strength update.
 */
export class CoyoteBackend implements HapticBackend {
  private readonly socket = new DglabV4Socket();
  private readonly assignments = new Map<string, string>();
  private readonly strengths = new Map<string, number>();
  /** Feature id -> last integer value sent, for change suppression. */
  private readonly lastSent = new Map<string, number>();
  private readonly lastSentAt = new Map<string, number>();
  private readonly lastWaveformAt = new Map<string, number>();
  /** Channels already reported as having no usable ceiling; keeps the warning to one line. */
  private readonly ceilingWarned = new Set<string>();
  private readonly mutedWarned = new Set<string>();

  private readonly stateListeners: StateListener[] = [];
  private readonly deviceListeners: DeviceListener[] = [];
  private readonly assignmentListeners: AssignmentListener[] = [];
  private readonly deviceStateListeners: Array<() => void> = [];

  private waveformSeq = 0;
  /** Device set last reported to listeners; guards against slot-state churn. */
  private lastDeviceKey = '';
  /** Displayed metadata last reported, so the UI only re-renders on real changes. */
  private lastStateKey = '';
  /** Empty means "use the browser's own host". */
  private hostOverride = '';

  masterStrength = 1.0;
  /** The Coyote has no linear actuator; kept only to satisfy the interface. */
  readonly linearRangeMin = 0;
  readonly linearRangeMax = 1;

  /** Pulse carrier frequency per device name; the single exposed waveform setting. */
  private readonly frequencies = new Map<string, number>();

  getCarrierFrequency(name: string): number | null {
    if (!this.coyotes().some((d) => deviceName(d) === name)) return null;
    return this.frequencies.get(name) ?? DEFAULT_PULSE_FREQUENCY;
  }

  setCarrierFrequency(name: string, frequency: number): void {
    this.frequencies.set(name, clampFrequency(frequency));
    this.persist();
  }

  constructor() {
    this.loadPersisted();
    this.socket.onStateChange((state) => {
      for (const l of this.stateListeners) l(state);
    });
    this.socket.onDevicesChange(() => {
      this.emitDevices();
      this.emitDeviceState();
    });
  }

  // --- Connection ---

  /** Host the DG-Lab app should dial. */
  get pairingHost(): string {
    return this.hostOverride || this.defaultPairingHost;
  }

  /**
   * The browser's own host, unless it is loopback: the server cannot see the
   * Docker host's LAN address, so the user has to enter it in that case.
   */
  get defaultPairingHost(): string {
    const own = window.location.host;
    return isLoopbackHost(own) ? '' : own;
  }

  setPairingHost(host: string): void {
    const normalized = normalizeHost(host);
    // Comparing against the default, not the current value, so re-typing the
    // default clears the override instead of pinning it.
    this.hostOverride = normalized === this.defaultPairingHost ? '' : normalized;
    this.persist();
  }

  /** Drops any override and goes back to the automatically detected host. */
  resetPairingHost(): void {
    this.hostOverride = '';
    this.persist();
  }

  /** Relay URL the DG-Lab app must be pointed at; null until the relay says hello. */
  get pairingUrl(): string | null {
    const tid = this.socket.targetId;
    if (!tid || !this.pairingHost) return null;
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${this.pairingHost}/ws/dglab?tid=${encodeURIComponent(tid)}`;
  }

  get appCount(): number { return this.socket.appCount; }

  connect(): void {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket.connect(`${scheme}://${window.location.host}/ws/dglab`);
  }

  disconnect(): void {
    void this.stopAll();
    this.socket.disconnect();
  }

  // --- HapticBackend ---

  onStateChange(listener: StateListener): void { this.stateListeners.push(listener); }
  onDevicesChange(listener: DeviceListener): void { this.deviceListeners.push(listener); }
  onAssignmentsChange(listener: AssignmentListener): void { this.assignmentListeners.push(listener); }
  onDeviceStateChange(listener: () => void): void { this.deviceStateListeners.push(listener); }

  get connectionState(): ConnectionState { return this.socket.connectionState; }

  get devices(): HapticDevice[] {
    return this.coyotes().map((device) => ({ name: deviceName(device) }));
  }

  getFeatures(device: HapticDevice): DeviceFeature[] {
    const source = this.coyotes().find((d) => deviceName(d) === device.name);
    if (!source) return [];
    return ([V4Channel.A, V4Channel.B] as V4ChannelId[]).map((channel, index) => {
      const name = channel === V4Channel.A ? 'Ch. A' : 'Ch. B';
      return {
        id: featureId(source, channel),
        deviceName: device.name,
        kind: 'estim' as const,
        index,
        descriptor: name,
        label: name,
      };
    });
  }

  getDeviceBadge(name: string): DeviceBadge | null {
    const source = this.coyotes().find((d) => deviceName(d) === name);
    if (!source || typeof source.index !== 'number') return null;
    const light = String(source.slotState?.markLight ?? '').toLowerCase();
    return {
      icon: `${source.index}-circle-fill`,
      color: MARK_LIGHT_COLORS[light],
      title: `Slot ${source.index}`,
    };
  }

  getDeviceAlerts(name: string): DeviceAlert[] {
    const source = this.coyotes().find((d) => deviceName(d) === name);
    if (!source || isSlotConnected(source)) return [];
    return [{ level: 'warning', message: 'Paired in the app but no device connected' }];
  }

  getFeatureDetails(id: string): FeatureDetail[] {
    for (const device of this.coyotes()) {
      for (const ch of [V4Channel.A, V4Channel.B] as V4ChannelId[]) {
        if (featureId(device, ch) !== id) continue;
        const muted = isChannelMuted(device, ch);
        return [
          { label: 'Output', value: muted ? 'Muted' : 'Enabled', warn: muted },
          { label: 'Mode', value: channelMode(device, ch) },
          { label: 'Absolute Limit', value: `${channelCeiling(device, ch)} / ${ABSOLUTE_SCALE}` },
        ];
      }
    }
    return [];
  }

  setFeatureChannel(id: string, channel: HapticChannel | null): void {
    const next = channel ? channelKey(channel) : null;
    if ((this.assignments.get(id) ?? null) === next) return;
    if (next === null) this.assignments.delete(id);
    else this.assignments.set(id, next);
    this.persist();
    const snapshot = new Map(this.assignments);
    for (const l of this.assignmentListeners) l(snapshot);
  }

  getFeatureChannel(id: string): string | null {
    return this.assignments.get(id) ?? null;
  }

  getDeviceStrength(name: string): number {
    return this.strengths.get(name) ?? 1;
  }

  setDeviceStrength(name: string, strength: number): void {
    this.strengths.set(name, clamp01(strength));
    this.persist();
  }

  hasFeaturesFor(channel: HapticChannel): boolean {
    return this.resolve(channel).length > 0;
  }

  hasLinearFor(): boolean { return false; }

  /**
   * Drive the channel's strength from the script.
   *
   * The pulse frame format nominally allows four amplitude sub-steps per frame,
   * but every waveform DG-Lab ships holds amplitude constant across a frame, and
   * modulating the sub-steps produced no output on real hardware. So the carrier
   * stays flat and the funscript drives channel strength, which is what the
   * device is built for.
   */
  sendContinuous(channel: HapticChannel, intensity: number): void {
    if (this.socket.connectionState !== 'connected') return;
    const now = Date.now();

    for (const { device, channel: ch } of this.resolve(channel)) {
      const id = featureId(device, ch);
      this.warnAboutChannel(device, ch, id);

      const status = channelStatus(device, ch);
      const usable = status !== STATUS_NO_CIRCUIT && status !== STATUS_DAMAGED && status !== STATUS_MASKED;
      const strength = this.masterStrength * this.getDeviceStrength(deviceName(device));
      const value = usable ? mapIntensity(intensity, strength, channelCeiling(device, ch)) : 0;

      this.pushStrength(device, ch, id, value, now);
      if (value > 0) this.pushCarrier(device, ch, id, now);
    }
  }

  /** Strength follows the script, refreshed before its dead-man's timer runs out. */
  private pushStrength(device: V4Device, ch: V4ChannelId, id: string, value: number, now: number): void {
    const elapsed = now - (this.lastSentAt.get(id) ?? 0);
    const unchanged = this.lastSent.get(id) === value;
    if (unchanged && elapsed < STRENGTH_DURATION_MS / 2) return;
    if (!unchanged && elapsed < STRENGTH_INTERVAL_MS) return;

    this.lastSent.set(id, value);
    this.lastSentAt.set(id, now);
    this.socket.send((reqId) => buildSetTempIntensity(reqId, device.id, ch, value, STRENGTH_DURATION_MS));
  }

  /**
   * Keep a flat carrier queued.
   *
   * Strength only scales pulses the device is already emitting, so without a
   * carrier a non-zero strength produces nothing. Sent with `im: true` so batches
   * replace rather than stack; restarting a constant carrier is inaudible.
   */
  private pushCarrier(device: V4Device, ch: V4ChannelId, id: string, now: number): void {
    if (now - (this.lastWaveformAt.get(id) ?? 0) < CARRIER_INTERVAL_MS) return;
    this.lastWaveformAt.set(id, now);

    const frames = carrierFrames(this.getCarrierFrequency(deviceName(device)) ?? DEFAULT_PULSE_FREQUENCY, CARRIER_FRAME_COUNT);
    this.waveformSeq += 1;
    const seq = this.waveformSeq;
    const duration = frames.length * FRAME_DURATION_MS;
    this.socket.send((reqId) => buildAppendPulseData(reqId, device.id, ch, frames, duration, seq));
  }

  private warnAboutChannel(device: V4Device, ch: V4ChannelId, id: string): void {
    if (channelCeiling(device, ch) === 0 && !this.ceilingWarned.has(id)) {
      this.ceilingWarned.add(id);
      console.warn('[dglab] no usable limit reported for this channel, refusing to guess one', device.slotState);
    }
    if (isChannelMuted(device, ch) && !this.mutedWarned.has(id)) {
      this.mutedWarned.add(id);
      console.warn(`[dglab] channel ${ch === V4Channel.A ? 'A' : 'B'} is muted in the DG-Lab app; it will stay silent`);
    }
  }

  sendLinear(): void { /* the Coyote has no positional actuator */ }

  async getBatteryLevel(device: HapticDevice): Promise<number | null> {
    const source = this.coyotes().find((d) => deviceName(d) === device.name);
    const power = source?.props?.power;
    // A running device is never at 0%, so treat that as "not reported" and show nothing.
    if (typeof power !== 'number' || power <= 0) return null;
    return clamp01(power > 1 ? power / 100 : power);
  }

  async stopAll(): Promise<void> {
    if (this.socket.connectionState !== 'connected') return;
    this.lastSent.clear();
    this.lastSentAt.clear();
    this.lastWaveformAt.clear();
    for (const device of this.coyotes()) {
      this.socket.send((reqId) => buildClear(reqId, device.id));
      for (const ch of [V4Channel.A, V4Channel.B] as V4ChannelId[]) {
        this.socket.send((reqId) => buildResetIntensity(reqId, device.id, ch));
      }
    }
  }

  // --- Internals ---

  private coyotes(): V4Device[] {
    return this.socket.devices.filter((d) => isCoyote(d.type));
  }

  private resolve(channel: HapticChannel): CoyoteChannelRef[] {
    const key = channelKey(channel);
    const refs: CoyoteChannelRef[] = [];
    for (const device of this.coyotes()) {
      for (const ch of [V4Channel.A, V4Channel.B] as V4ChannelId[]) {
        if (this.assignments.get(featureId(device, ch)) === key) refs.push({ device, channel: ch });
      }
    }
    return refs;
  }

  private emitDevices(): void {
    const devices = this.devices;
    // The app streams slots.patch several times a second as warmUpScale and
    // intensity move. Reporting those as device changes makes the sync engine
    // resync and stop all output, which also restarts the device's warm-up ramp.
    const key = devices.map((d) => d.name).join('|');
    if (key === this.lastDeviceKey) return;
    this.lastDeviceKey = key;
    for (const l of this.deviceListeners) l(devices);
  }

  /**
   * Notify the UI when metadata it displays changes.
   *
   * Keyed on displayed fields only, so the constant `intensityA` and
   * `warmUpScale` traffic does not re-render the card out from under the user.
   */
  private emitDeviceState(): void {
    const key = this.coyotes().map((device) => [
      device.id,
      device.index,
      device.slotState?.markLight,
      device.slotState?.hasDevice,
      device.props?.power,
      ...([V4Channel.A, V4Channel.B] as V4ChannelId[]).flatMap((ch) => [
        isChannelMuted(device, ch),
        channelCeiling(device, ch),
        channelMode(device, ch),
      ]),
    ].join(':')).join('|');

    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    for (const l of this.deviceStateListeners) l();
  }

  setLinearRange(): void { /* no linear actuator */ }

  private persist(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(Object.fromEntries(this.assignments)));
    window.localStorage.setItem(STRENGTHS_KEY, JSON.stringify(Object.fromEntries(this.strengths)));
    window.localStorage.setItem(FREQUENCY_KEY, JSON.stringify(Object.fromEntries(this.frequencies)));
    window.localStorage.setItem(PAIRING_HOST_KEY, this.hostOverride);
  }

  private loadPersisted(): void {
    if (typeof window === 'undefined') return;
    for (const [id, key] of Object.entries(readJsonRecord(ASSIGNMENTS_KEY))) {
      if (typeof key === 'string') this.assignments.set(id, key);
    }
    for (const [name, value] of Object.entries(readJsonRecord(STRENGTHS_KEY))) {
      if (typeof value === 'number') this.strengths.set(name, clamp01(value));
    }
    for (const [name, value] of Object.entries(readJsonRecord(FREQUENCY_KEY))) {
      if (typeof value === 'number') this.frequencies.set(name, clampFrequency(value));
    }
    this.hostOverride = normalizeHost(window.localStorage.getItem(PAIRING_HOST_KEY) ?? '');
  }
}

function readJsonRecord(key: string): Record<string, unknown> {
  const raw = window.localStorage.getItem(key);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    window.localStorage.removeItem(key);
    return {};
  }
}
