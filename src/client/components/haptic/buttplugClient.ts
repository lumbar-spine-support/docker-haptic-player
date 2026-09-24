import {
    ButtplugClient,
    ButtplugBrowserWebsocketClientConnector,
    ButtplugClientDevice,
    ActuatorType,
    LinearCmd,
    RotateCmd,
    RotateSubcommand,
    ScalarSubcommand,
    VectorSubcommand,
} from 'buttplug';
import { channelKey, type HapticChannel } from '../../../shared/haptics';
import {
    type AssignmentListener,
    type ConnectionState,
    type DeviceFeature,
    type DeviceListener,
    type FeatureKind,
    type HapticBackend,
    type HapticDevice,
    type StateListener,
} from './backend';

export type { ConnectionState, DeviceFeature, FeatureKind } from './backend';

const FEATURE_ASSIGNMENTS_KEY = 'happy-feature-assignments';
const DEVICE_STRENGTHS_KEY = 'happy-device-strengths';
const LINEAR_RANGE_KEY = 'happy-stroker-range';

/** A Buttplug actuator, which additionally carries its wire-level actuator type. */
interface ButtplugFeature extends DeviceFeature {
    actuator: ActuatorType;
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
    /** Device name → strength multiplier 0–1, applied on top of `masterStrength`. */
    private readonly deviceStrengths = new Map<string, number>();

    /** Master strength multiplier 0–1 applied to vibration/rotation commands. */
    masterStrength = 1.0;

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
        return this.buttplugFeatures(device);
    }

    private buttplugFeatures(target: HapticDevice): ButtplugFeature[] {
        const device = this.getConnectedDevices().find((d) => d === target);
        if (!device) return [];

        const features: ButtplugFeature[] = [];
        const counts = new Map<string, number>();

        const push = (kind: FeatureKind, index: number, actuator: ActuatorType, descriptor: string): void => {
            const name = actuator === ActuatorType.Unknown ? kindLabel(kind) : String(actuator);
            const ordinal = (counts.get(name) ?? 0) + 1;
            counts.set(name, ordinal);
            features.push({
                id: makeFeatureId(device.name, kind, index),
                deviceName: device.name,
                kind,
                index,
                actuator,
                descriptor,
                label: ordinal > 1 ? `${name} ${ordinal}` : name,
            });
        };

        const rotateAttrs = device.messageAttributes.RotateCmd ?? [];
        // A rotating actuator is advertised twice: once under ScalarCmd (speed only) and
        // once under RotateCmd (speed + direction). Keep only the direction-capable one.
        let scalarRotatesToDrop = rotateAttrs.length;

        for (const attr of device.messageAttributes.ScalarCmd ?? []) {
            if (attr.ActuatorType === ActuatorType.Rotate && scalarRotatesToDrop > 0) {
                scalarRotatesToDrop--;
                continue;
            }
            push('scalar', attr.Index, attr.ActuatorType, attr.FeatureDescriptor);
        }
        for (const attr of rotateAttrs) {
            push('rotate', attr.Index, ActuatorType.Rotate, attr.FeatureDescriptor);
        }
        for (const attr of device.messageAttributes.LinearCmd ?? []) {
            push('linear', attr.Index, ActuatorType.Position, attr.FeatureDescriptor);
        }

        return features;
    }

    /** Assign one actuator to a channel, or pass null to unassign it. */
    setFeatureChannel(featureId: string, channel: HapticChannel | null): void {
        const next = channel ? channelKey(channel) : null;
        const current = this.featureAssignments.get(featureId) ?? null;
        if (current === next) return;

        if (next === null) this.featureAssignments.delete(featureId);
        else this.featureAssignments.set(featureId, next);

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

            this.client.addListener('deviceadded', () => this.emitDevices());
            this.client.addListener('deviceremoved', () => this.emitDevices());
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

        for (const { device, feature } of this.resolve(channel)) {
            const strength = this.masterStrength * this.getDeviceStrength(device.name);
            if (feature.kind === 'scalar') {
                const value = clamp01(intensity * strength);
                void device.scalar(new ScalarSubcommand(feature.index, value, feature.actuator))
                    .catch((err) => console.debug('[buttplug] scalar failed:', err));
            } else if (feature.kind === 'rotate') {
                const { speed, clockwise } = positionToRotate(intensity);
                const cmd = new RotateCmd(
                    [new RotateSubcommand(feature.index, clamp01(speed * strength), clockwise)],
                    device.index,
                );
                void device.send(cmd).catch((err) => console.debug('[buttplug] rotate failed:', err));
            }
        }
    }

    /** Edge-triggered move for a channel's linear actuators. */
    sendLinear(channel: HapticChannel, position: number, durationMs: number): void {
        if (this.state !== 'connected') return;

        // Stroker travel is rescaled into the configured min/max range, not the master strength.
        const scaled = this.linearRangeMin + clamp01(position) * (this.linearRangeMax - this.linearRangeMin);
        // Buttplug's LinearCmd requires an integer (u32) duration in ms.
        const duration = Math.max(1, Math.round(durationMs));

        for (const { device, feature } of this.resolve(channel)) {
            if (feature.kind !== 'linear') continue;
            const cmd = new LinearCmd([new VectorSubcommand(feature.index, scaled, duration)], device.index);
            void device.send(cmd).catch((err) => console.debug('[buttplug] linear failed:', err));
        }
    }

    /**
     * Read the battery level (0–1) from a device.
     * Returns null if the device does not support battery reporting or if the query fails.
     */
    async getBatteryLevel(device: HapticDevice): Promise<number | null> {
        const owned = this.getConnectedDevices().find((d) => d === device);
        if (!owned) return null;
        try {
            return await owned.battery();
        } catch {
            return null;
        }
    }

    /** Stop all devices immediately. */
    async stopAll(): Promise<void> {
        if (!this.client || this.state !== 'connected') return;
        for (const device of this.getConnectedDevices()) {
            void device.stop().catch(() => undefined);
        }
    }

    /** Connected actuators assigned to a channel, paired with their device. */
    private resolve(channel: HapticChannel): Array<{ device: ButtplugClientDevice; feature: ButtplugFeature }> {
        const key = channelKey(channel);
        const matches: Array<{ device: ButtplugClientDevice; feature: ButtplugFeature }> = [];
        for (const device of this.getConnectedDevices()) {
            for (const feature of this.buttplugFeatures(device)) {
                if (this.featureAssignments.get(feature.id) === key) matches.push({ device, feature });
            }
        }
        return matches;
    }

    private setState(s: ConnectionState): void {
        this.state = s;
        for (const l of this.stateListeners) l(s);
    }

    private emitDevices(): void {
        const devices = this.getConnectedDevices();
        for (const l of this.deviceListeners) l(devices);
    }

    private emitAssignments(): void {
        const assignments = new Map(this.featureAssignments);
        for (const l of this.assignmentListeners) l(assignments);
    }

    private getConnectedDevices(): ButtplugClientDevice[] {
        if (!this.client || !this.client.connected) return [];
        return this.client.devices;
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

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
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
