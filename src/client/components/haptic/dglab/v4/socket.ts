const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
/** `props` such as battery level only arrive with a full snapshot, so re-ask for one. */
const DEVICE_REFRESH_MS = 30_000;
/** Pulse frame encoding version; 3 is the Coyote 3.0 `[freq×4, intensity×4]` layout. */
const PULSE_VERSION = 3;
const PRIORITY: NonNullable<V4OperateOptions['priority']> = 1;

/** `device.op` replies only arrive once a task ends; neither of these is a real failure. */
const IGNORED_ERRORS = new Set(['DGLAB-socket-response-timeout', 'DGLAB-socket-disconnected']);

import { Emitter } from '../../emitter';
import {
    DGLAB_SOCKET_STATE,
    DglabSocket,
    V4ActionType,
    type DglabSocketCloseEvent,
    type DglabSocketV4Client,
    type V4Channel,
    type V4DeviceInfo,
    type V4OperateOptions,
    type V4RpcMethod,
    type V4ServerFrame,
} from 'dglab-kit';
import { createLogger } from '../../../../utils/logger';
import type { ConnectionState } from '../../backend';

const log = createLogger('dglab:socket');
const trace = log.debug;

/** `id` is the app's own slot number; the app sends it but the kit does not type it. */
export type Device = V4DeviceInfo & { id?: number };

type OpKind = V4ActionType | Extract<V4RpcMethod, 'device.op.clear'>;

const opName = (kind: OpKind): string => typeof kind === 'number' ? V4ActionType[kind] : kind;

/** Listener callback type for socket state or device changes. */
type Listener<T> = (value: T) => void;

/** Delegating instantiation of the underlying DglabSocketV4Client to a factory allows for insertion
 * of test doubles or mocks. */
export type SocketFactory = (url: string) => DglabSocketV4Client;

/**
 * Controller side of the DG-Lab V4 relay, on top of dglab-kit.
 *
 * Adds what the kit leaves to the caller: reconnecting, device refresh,
 * routing each slot to its app, and operations that never throw; `clear` and
 * `resetIntensity` settle once the app has replied.
 */
export class DglabV4Socket {
    private kit: DglabSocketV4Client | null = null;
    private url = '';
    private state: ConnectionState = 'disconnected';
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private closedByUser = false;
    private readonly loggedOnce = new Set<string>();
    private readonly stateChanged = new Emitter<ConnectionState>();
    private readonly devicesChanged = new Emitter<Device[]>();
    private readonly activity = new Emitter<number>();

    constructor(private readonly createSocket: SocketFactory = (url) => new DglabSocket({ url })) { }

    onStateChange(l: Listener<ConnectionState>): void { this.stateChanged.on(l); }
    onDevicesChange(l: Listener<Device[]>): void { this.devicesChanged.on(l); }
    onActivity(l: Listener<number>): void { this.activity.on(l); }

    get connectionState(): ConnectionState { return this.state; }
    /** Value the DG-Lab app must pass as `?tid=`; null until the relay says hello. */
    get targetId(): string | null { return this.kit?.targetId ?? null; }
    get appCount(): number { return this.kit?.clientIds.length ?? 0; }
    get devices(): Device[] {
        return (this.kit?.clients ?? []).flatMap((client) => client.devices);
    }

    /** Establish a connection to the DG-Lab V4 relay at the specified URL. */
    connect(url: string): void {
        if (this.state === 'connecting' || this.state === 'connected') {
            return;
        }
        const shouldCreateNewSocket = !this.kit || url !== this.url;
        if (shouldCreateNewSocket) {
            this.kit?.destroy();
            this.url = url;
            this.kit = this.createSocket(url);
            this.listen(this.kit);
        }
        this.closedByUser = false;
        this.open();
    }

    disconnect(): void {
        this.closedByUser = true;
        this.clearReconnect();
        this.stopDeviceRefresh();
        this.kit?.disconnect();
        this.setState('disconnected');
        this.emitDevices();
    }

    /**
     * Continuous absolute strength. The task auto-resets after `durationMs`, which
     * doubles as a dead-man's switch when the tab or the network dies.
     */
    setTempIntensity(slotId: string, channel: V4Channel, value: number, durationMs: number): void {
        const v = Math.max(0, Math.round(value));
        const d = Math.max(1, Math.round(durationMs));
        this.op(slotId, V4ActionType.SetTempIntensity, { c: channel, v, d }, (kit, cid) =>
            kit.setTempIntensity(cid, slotId, channel, v, d, { priority: PRIORITY, immediate: true }));
    }

    /** The app loops the frames for `d` ms (`d: 0` loops forever), so `d` must equal the frames' play time. */
    appendPulse(slotId: string, channel: V4Channel, frames: string[], durationMs: number, seq: number, replace = true): void {
        const d = Math.max(1, Math.round(durationMs));
        this.op(slotId, V4ActionType.AppendPulseData, { c: channel, d, seq, im: replace }, (kit, cid) =>
            kit.sendPulse(cid, slotId, channel, d, frames, { priority: PRIORITY, immediate: replace, version: PULSE_VERSION, seq }));
    }

    /** `SetIntensity` accepts no value other than 0. Settles once the app has replied. */
    resetIntensity(slotId: string, channel: V4Channel): Promise<void> {
        return this.op(slotId, V4ActionType.SetIntensity, { c: channel }, (kit, cid) =>
            kit.resetIntensity(cid, slotId, channel, { priority: PRIORITY }));
    }

    /** Cancel every running task on a slot. Settles once the app has replied. */
    clear(slotId: string): Promise<void> {
        return this.op(slotId, 'device.op.clear', undefined, (kit, cid) => kit.clearOperate(cid, { slotId }));
    }

    /** Re-read the device list from every attached app. */
    refreshDevices(): void {
        const kit = this.kit;
        if (!kit) return;
        for (const clientId of kit.clientIds) this.requestDevices(kit, clientId);
    }

    private requestDevices(kit: DglabSocketV4Client, clientId: string): void {
        const method: V4RpcMethod = 'devices.get';
        trace('->', method, clientId);
        kit.requestDevices(clientId).catch((err: Error) => {
            if (err.name !== 'DGLAB-socket-disconnected') log.warn(`${method} failed:`, err.message);
        });
    }

    private op(
        slotId: string,
        kind: OpKind,
        args: Record<string, unknown> | undefined,
        send: (kit: DglabSocketV4Client, clientId: string) => Promise<unknown>,
    ): Promise<void> {
        const kit = this.kit;
        const clientId = kit?.clients.find((c) => c.devices.some((d) => d.slotId === slotId))?.clientId;
        if (!kit || !clientId || this.state !== 'connected') return Promise.resolve();
        const what = opName(kind);
        if (args) trace('->', clientId, slotId, what, args);
        else trace('->', clientId, slotId, what);
        return send(kit, clientId).then((result) => trace('<-', slotId, what, result), (err: Error) => {
            if (IGNORED_ERRORS.has(err.name)) return;
            this.logOnce(`${err.message}:${what}`, `${what} on ${slotId} rejected:`, err.message, ...(args ? [args] : []));
        });
    }

    private listen(kit: DglabSocketV4Client): void {
        kit.on('open', () => { this.reconnectAttempts = 0; });
        kit.on('state', (next) => {
            if (next === DGLAB_SOCKET_STATE.WaitingForPeer || next === DGLAB_SOCKET_STATE.Paired) this.setState('connected');
        });
        kit.on('error', (err) => {
            trace('error', err);
            if (this.state !== 'connected') this.setState('error');
        });
        kit.on('close', (event) => this.handleClose(event));
        kit.on('frame', (frame) => {
            this.activity.emit(Date.now());
            const { type } = frame as V4ServerFrame;
            if (type !== 'heartbeat' && type !== 'pong' && type !== 'message') trace('<-', frame);
        });
        kit.on('action', (action) => trace('custom.action', action));
        kit.on('client-attached', (clientId) => {
            this.requestDevices(kit, clientId);
            this.startDeviceRefresh();
        });
        kit.on('client-disconnected', () => {
            if (kit.clientIds.length === 0) this.stopDeviceRefresh();
            this.emitDevices();
        });
        kit.on('devices', (devices, clientId) => {
            trace('devices', clientId, devices);
            this.emitDevices();
        });
    }

    private handleClose(event: DglabSocketCloseEvent): void {
        this.stopDeviceRefresh();
        this.emitDevices();
        if (this.closedByUser) {
            this.setState('disconnected');
            return;
        }
        if (event.reason === 'replaced') {
            log.warn('another tab took over the DG-Lab connection');
            this.closedByUser = true;
            this.setState('disconnected');
            return;
        }
        this.setState('error');
        this.scheduleReconnect();
    }

    private open(): void {
        this.setState('connecting');
        try {
            this.kit?.connect().catch(() => { /* the close event drives reconnecting */ });
        } catch {
            this.setState('error');
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.closedByUser || this.reconnectTimer !== null) return;
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.closedByUser) this.open();
        }, delay);
    }

    private clearReconnect(): void {
        if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
    }

    private startDeviceRefresh(): void {
        if (this.refreshTimer !== null) return;
        this.refreshTimer = setInterval(() => this.refreshDevices(), DEVICE_REFRESH_MS);
    }

    private stopDeviceRefresh(): void {
        if (this.refreshTimer === null) return;
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
    }

    private logOnce(key: string, ...args: unknown[]): void {
        if (this.loggedOnce.has(key)) return;
        this.loggedOnce.add(key);
        log.warn(...args);
    }

    private setState(next: ConnectionState): void {
        if (this.state === next) return;
        this.state = next;
        this.stateChanged.emit(next);
    }

    private emitDevices(): void {
        this.devicesChanged.emit(this.devices);
    }
}
