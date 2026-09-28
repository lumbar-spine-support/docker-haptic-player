import {
    ButtplugClient,
    ButtplugBrowserWebsocketClientConnector,
    ButtplugClientDevice,
    DeviceOutputCommand,
    InputCommandType,
    InputType,
    OutputType,
    type IButtplugClientDeviceFeature,
} from 'buttplug';
import { channelKey, type HapticChannel } from '../../../shared/haptics';
import {
    type AssignmentListener,
    type ConnectionState,
    type DeviceFeature,
    type DeviceListener,
    type FeatureDetail,
    type FeatureKind,
    type HapticBackend,
    type HapticDevice,
    type StateListener,
} from './backend';

export type { ConnectionState, DeviceFeature, FeatureKind } from './backend';

const FEATURE_ASSIGNMENTS_KEY = 'happy-feature-assignments';
const DEVICE_STRENGTHS_KEY = 'happy-device-strengths';
const LINEAR_RANGE_KEY = 'happy-stroker-range';

const OUTPUT_ICONS: Partial<Record<OutputType, string>> = {
    [OutputType.Oscillate]: 'bi-water',
    [OutputType.Constrict]: 'bi-arrows-angle-contract',
    [OutputType.Inflate]: 'bi-arrows-angle-expand',
    [OutputType.Temperature]: 'bi-thermometer-half',
    [OutputType.Led]: 'bi-lightbulb-fill',
    [OutputType.Spray]: 'bi-droplet-fill',
};

/** Outputs that must not be driven by a script; see docs/intiface.md. */
const UNSUPPORTED_OUTPUTS: ReadonlySet<OutputType> = new Set([OutputType.Temperature, OutputType.Led, OutputType.Spray]);

/** A Buttplug actuator, which additionally carries its wire-level output type. */
interface ButtplugFeature extends DeviceFeature {
    actuator: OutputType;
    /** Device-reported resolution; commands are quantised to 0..stepCount. */
    stepCount: number;
    range: readonly [min: number, max: number];
    durationRange?: readonly [min: number, max: number];
    source: IButtplugClientDeviceFeature;
}

interface ResolvedFeature {
    device: ButtplugClientDevice;
    feature: ButtplugFeature;
}

function makeFeatureId(deviceName: string, kind: FeatureKind, index: number): string {
    return `${deviceName}#${kind}#${index}`;
}

/**
 * Map a normalised position (0–1) to a rotate command { speed, clockwise }.
 *
 * The rotate actuator on devices like the Nexus Revo Stealth has stepped levels:
 *   -2, -1, 0, +1, +2  (sign = direction, magnitude = speed tier)
 */
export function positionToRotate(pos: number): { speed: number; clockwise: boolean } {
    if (pos === 0) return { speed: 0, clockwise: true };
    const clockwise = pos > 0;
    const abs = Math.abs(pos);
    const speed = abs >= 0.5 ? 1.0 : 0.5;
    return { speed, clockwise };
}

/**
 * Manages the Buttplug.io WebSocket connection to an Intiface server.
 *
 * Assignment happens per *feature* (one actuator), not per device: a two-motor
 * toy can drive its vibrator from one script and its rotator from another, and
 * scripts are addressed by channel (`estim`, `estim:nipples`, …) rather than by
 * bare funscript type.
 */
export class ButtplugClientManager implements HapticBackend {
    private client: ButtplugClient | null = null;
    private state: ConnectionState = 'disconnected';
    private readonly stateListeners: StateListener[] = [];
    private readonly deviceListeners: DeviceListener[] = [];
    private readonly assignmentListeners: AssignmentListener[] = [];

    /** Feature id → channel key. */
    private readonly featureAssignments = new Map<string, string>();
    /** Device name → strength multiplier 0–1. */
    private readonly deviceStrengths = new Map<string, number>();
    /** Feature id → last value sent, in device steps (signed for rotation direction). */
    private readonly lastSteps = new Map<string, number>();
    private readonly featureCache = new Map<ButtplugClientDevice, ButtplugFeature[]>();
    /** Channel key → assigned actuators; cleared on device or assignment changes. */
    private readonly channelCache = new Map<string, ResolvedFeature[]>();
    /** Device → timestamp of the last continuous command, for messageTimingGap throttling. */
    private readonly lastSendAt = new Map<ButtplugClientDevice, number>();

    /** Min/max output range (0–1) that linear (stroker) positions are rescaled into. */
    linearRangeMin = 0;
    linearRangeMax = 1;

    constructor() {
        this.loadPersisted();
    }

    /** Set the min/max position range (0–1) used to rescale stroker moves. */
    setLinearRange(min: number, max: number): void {
        this.linearRangeMin = clamp01(min);
        this.linearRangeMax = clamp01(max);
        this.persist();
    }

    /** Registers a listener for connection-state changes. */
    onStateChange(l: StateListener): void { this.stateListeners.push(l); }
    /** Registers a listener for device add/remove changes. */
    onDevicesChange(l: DeviceListener): void { this.deviceListeners.push(l); }
    /** Registers a listener for feature-assignment changes. */
    onAssignmentsChange(l: AssignmentListener): void { this.assignmentListeners.push(l); }

    /** Current Intiface connection state. */
    get connectionState(): ConnectionState { return this.state; }
    /** Snapshot of currently connected devices. */
    get devices(): ButtplugClientDevice[] { return this.getConnectedDevices(); }

    // --- Features and assignment ---

    /** Every individually addressable actuator of a device. */
    getFeatures(device: HapticDevice): DeviceFeature[] {
        const owned = this.getConnectedDevices().find((d) => d === device);
        return owned ? this.featuresOf(owned) : [];
    }

    private featuresOf(device: ButtplugClientDevice): ButtplugFeature[] {
        let features = this.featureCache.get(device);
        if (!features) {
            features = buildFeatures(device);
            this.featureCache.set(device, features);
        }
        return features;
    }

    /** Current output, range and resolution of one actuator, for its detail panel. */
    getFeatureDetails(featureId: string): FeatureDetail[] {
        for (const device of this.getConnectedDevices()) {
            const feature = this.featuresOf(device).find((f) => f.id === featureId);
            if (!feature) continue;
            const [low, high] = feature.range;
            const current = this.lastSteps.get(featureId) ?? 0;
            return [
                { label: 'Value', value: `${current}` },
                { label: 'Limits', value: `[${low}, ${high}]` },
                { label: 'Step Limit', value: `[0, ${feature.stepCount}]` },
            ];
        }
        return [];
    }

    /** Assign one actuator to a channel, or pass null to unassign it. */
    setFeatureChannel(featureId: string, channel: HapticChannel | null): void {
        const next = channel ? channelKey(channel) : null;
        const current = this.featureAssignments.get(featureId) ?? null;
        if (current === next) return;

        if (next === null) this.featureAssignments.delete(featureId);
        else this.featureAssignments.set(featureId, next);

        this.channelCache.clear();
        this.persist();
        this.emitAssignments();
    }

    /** Channel key assigned to an actuator, or null. */
    getFeatureChannel(featureId: string): string | null {
        return this.featureAssignments.get(featureId) ?? null;
    }

    /** Per-device strength multiplier (0–1); defaults to full strength. */
    getDeviceStrength(deviceName: string): number {
        return this.deviceStrengths.get(deviceName) ?? 1;
    }

    setDeviceStrength(deviceName: string, strength: number): void {
        this.deviceStrengths.set(deviceName, clamp01(strength));
        this.persist();
    }

    /** Whether any connected actuator is currently driven by this channel. */
    hasFeaturesFor(channel: HapticChannel): boolean {
        return this.resolve(channel).length > 0;
    }

    /** Whether the channel drives a linear actuator, which needs edge-triggered moves. */
    hasLinearFor(channel: HapticChannel): boolean {
        return this.resolve(channel).some(({ feature }) => feature.kind === 'linear');
    }

    /** Connect to the Intiface WebSocket server at the given address. */
    async connect(address: string): Promise<void> {
        if (this.state === 'connecting' || this.state === 'connected') return;
        this.setState('connecting');

        try {
            this.client = new ButtplugClient('AudioHapticPlayer');

            this.client.addListener('deviceadded', (device: ButtplugClientDevice) => this.onDeviceChanged(device));
            this.client.addListener('deviceremoved', (device: ButtplugClientDevice) => this.onDeviceChanged(device));
            this.client.addListener('disconnect', () => this.setState('disconnected'));

            const connector = new ButtplugBrowserWebsocketClientConnector(address);
            await this.client.connect(connector);
            this.setState('connected');
            await this.client.startScanning();
        } catch (err) {
            // Expected when no Intiface server is running at the given address; avoid noisy console errors.
            console.debug('[buttplug] Connection failed:', err);
            this.setState('error');
        }
    }

    /** Disconnects from Intiface and returns the manager to a disconnected state. */
    async disconnect(): Promise<void> {
        if (this.client && this.state === 'connected') {
            await this.client.disconnect();
        }
        this.setState('disconnected');
    }

    /**
     * Continuous output for a channel: drives every assigned scalar and rotate
     * actuator with the interpolated script position (0–1).
     */
    sendContinuous(channel: HapticChannel, intensity: number): void {
        if (this.state !== 'connected') return;

        const now = performance.now();
        for (const { device, feature } of this.resolve(channel)) {
            if (feature.kind === 'linear') continue;
            const gap = device.messageTimingGap ?? 0;
            if (gap > 0 && now - (this.lastSendAt.get(device) ?? -Infinity) < gap) continue;

            const strength = this.getDeviceStrength(device.name);
            // Signed target in [-1, 1]; negative means counter-clockwise rotation.
            let target: number;
            if (feature.kind === 'scalar') {
                target = clamp01(intensity * strength);
            } else {
                const { speed, clockwise } = positionToRotate(intensity);
                target = clamp01(speed * strength) * (clockwise ? 1 : -1);
            }
            const percent = toPercent(feature.range, target);
            const steps = percentToValue(feature.range, percent);
            if (this.lastSteps.get(feature.id) === steps) continue;

            this.lastSteps.set(feature.id, steps);
            this.lastSendAt.set(device, now);
            void feature.source.runOutput(DeviceOutputCommand.createPercent(feature.actuator, percent))
                .catch((err) => console.debug(`[buttplug] ${feature.kind} failed:`, err));
        }
    }

    /** Edge-triggered move for a channel's linear actuators. */
    sendLinear(channel: HapticChannel, position: number, durationMs: number): void {
        if (this.state !== 'connected') return;

        // Stroker travel is rescaled into the configured min/max range, not the device strength.
        const scaled = this.linearRangeMin + clamp01(position) * (this.linearRangeMax - this.linearRangeMin);
        // Buttplug requires an integer (u32) duration in ms.
        const duration = Math.max(1, Math.round(durationMs));

        for (const { feature } of this.resolve(channel)) {
            if (feature.kind !== 'linear') continue;
            // The library rejects durations outside the device-reported range.
            const [minMs, maxMs] = feature.durationRange ?? [duration, duration];
            const clamped = Math.min(maxMs, Math.max(minMs, duration));
            this.lastSteps.set(feature.id, percentToValue(feature.range, scaled));
            void feature.source
                .runOutput(DeviceOutputCommand.createPercent(OutputType.HwPositionWithDuration, scaled, clamped))
                .catch((err) => console.debug('[buttplug] linear failed:', err));
        }
    }

    /**
     * Read the battery level (0–1) from a device.
     * Returns null if the device does not support battery reporting or if the query fails.
     */
    async getBatteryLevel(device: HapticDevice): Promise<number | null> {
        const owned = this.getConnectedDevices().find((d) => d === device);
        const feature = owned && Array.from(owned.features.values()).find((f) => f.hasInput(InputType.Battery));
        if (!feature) return null;
        try {
            const reading = await feature.runInput(InputType.Battery, InputCommandType.Read);
            // Buttplug v5 reports battery as a percentage (0–100).
            return reading ? clamp01(reading.value / 100) : null;
        } catch {
            return null;
        }
    }

    /** Stop all devices immediately. */
    async stopAll(): Promise<void> {
        if (!this.client || this.state !== 'connected') return;
        this.lastSteps.clear();
        await this.client.stopAllDevices().catch(() => undefined);
    }

    /** Connected actuators assigned to a channel, paired with their device. */
    private resolve(channel: HapticChannel): ResolvedFeature[] {
        const key = channelKey(channel);
        let matches = this.channelCache.get(key);
        if (matches) return matches;

        matches = [];
        for (const device of this.getConnectedDevices()) {
            for (const feature of this.featuresOf(device)) {
                if (feature.unsupported) continue;
                if (this.featureAssignments.get(feature.id) === key) matches.push({ device, feature });
            }
        }
        this.channelCache.set(key, matches);
        return matches;
    }

    private invalidateDeviceCaches(): void {
        this.featureCache.clear();
        this.channelCache.clear();
        this.lastSendAt.clear();
    }

    private setState(s: ConnectionState): void {
        this.state = s;
        if (s !== 'connected') {
            this.invalidateDeviceCaches();
            this.lastSteps.clear();
        }
        for (const l of this.stateListeners) l(s);
    }

    /** A device that (re)appears starts stopped, so its last-sent values must not suppress the next command. */
    private onDeviceChanged(device: ButtplugClientDevice): void {
        for (const feature of this.featureCache.get(device) ?? buildFeatures(device)) {
            this.lastSteps.delete(feature.id);
        }
        this.emitDevices();
    }

    private emitDevices(): void {
        this.invalidateDeviceCaches();
        const devices = this.getConnectedDevices();
        for (const l of this.deviceListeners) l(devices);
    }

    private emitAssignments(): void {
        const assignments = new Map(this.featureAssignments);
        for (const l of this.assignmentListeners) l(assignments);
    }

    private getConnectedDevices(): ButtplugClientDevice[] {
        if (!this.client || !this.client.connected) return [];
        return Array.from(this.client.devices.values());
    }

    private persist(): void {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(FEATURE_ASSIGNMENTS_KEY, JSON.stringify(Object.fromEntries(this.featureAssignments)));
        window.localStorage.setItem(DEVICE_STRENGTHS_KEY, JSON.stringify(Object.fromEntries(this.deviceStrengths)));
        window.localStorage.setItem(LINEAR_RANGE_KEY, JSON.stringify({ min: this.linearRangeMin, max: this.linearRangeMax }));
    }

    private loadPersisted(): void {
        if (typeof window === 'undefined') return;

        for (const [id, key] of Object.entries(readJsonRecord(FEATURE_ASSIGNMENTS_KEY))) {
            if (typeof key === 'string') this.featureAssignments.set(id, key);
        }
        for (const [name, value] of Object.entries(readJsonRecord(DEVICE_STRENGTHS_KEY))) {
            if (typeof value === 'number') this.deviceStrengths.set(name, clamp01(value));
        }

        const range = readJsonRecord(LINEAR_RANGE_KEY);
        if (typeof range['min'] === 'number') this.linearRangeMin = clamp01(range['min']);
        if (typeof range['max'] === 'number') this.linearRangeMax = clamp01(range['max']);
    }
}

/** Every individually addressable actuator of a device, derived from its v5 feature outputs. */
function buildFeatures(device: ButtplugClientDevice): ButtplugFeature[] {
    const features: ButtplugFeature[] = [];
    const counts = new Map<string, number>();

    for (const source of device.features.values()) {
        for (const output of source.outputs.values()) {
            const kind = outputKind(output.type);
            if (!kind) continue;

            const name = output.type === OutputType.Unknown ? kindLabel(kind) : String(output.type);
            const ordinal = (counts.get(name) ?? 0) + 1;
            counts.set(name, ordinal);
            const [min, max] = output.valueRange;
            features.push({
                id: makeFeatureId(device.name, kind, source.index),
                deviceName: device.name,
                kind,
                index: source.index,
                actuator: output.type,
                stepCount: Math.max(Math.abs(min), Math.abs(max)),
                range: [min, max],
                durationRange: output.durationRange,
                descriptor: source.featureDescriptor,
                source,
                label: ordinal > 1 ? `${name} ${ordinal}` : name,
                icon: OUTPUT_ICONS[output.type],
                unsupported: UNSUPPORTED_OUTPUTS.has(output.type),
            });
        }
    }

    return features;
}

function outputKind(type: OutputType): FeatureKind | null {
    if (type === OutputType.Rotate) return 'rotate';
    if (type === OutputType.HwPositionWithDuration) return 'linear';
    // Bare Position has no duration, so it cannot drive timed stroker moves.
    return type === OutputType.Position ? null : 'scalar';
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/** Map a signed target (-1..1) onto the library's 0..1 percent of [min, max]. */
function toPercent([min]: readonly [number, number], target: number): number {
    return min < 0 ? (target + 1) / 2 : Math.abs(target);
}

/** Mirrors the library's percent-to-value conversion, for dedup and the detail panel. */
function percentToValue([min, max]: readonly [number, number], percent: number): number {
    return Math.ceil(min + (max - min) * percent);
}

function kindLabel(kind: FeatureKind): string {
    return kind === 'linear' ? 'Linear' : kind === 'rotate' ? 'Rotate' : 'Scalar';
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
