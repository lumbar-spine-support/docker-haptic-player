import {
  eventName,
  eventPayload,
  isAppMessage,
  isRelayFrame,
  mergeSlotState,
  parseDevice,
  parseDeviceList,
  buildDevicesGet,
  V4ActionType,
  type AppMessage,
  type RelayFrame,
  type V4Device,
} from './protocol';

export type DglabSocketState = 'disconnected' | 'connecting' | 'connected' | 'error';

const REQUEST_TIMEOUT_MS = 5_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
/** `props` such as battery level only arrive with a full snapshot, so re-ask for one. */
const DEVICE_REFRESH_MS = 30_000;
/** How many recent request descriptions to keep for error attribution. */
const SENT_LOG_LIMIT = 200;

const ACTION_NAMES: Record<number, string> = {
  [V4ActionType.AppendPulseData]: 'AppendPulseData',
  [V4ActionType.AddIntensity]: 'AddIntensity',
  [V4ActionType.SetTempIntensity]: 'SetTempIntensity',
  [V4ActionType.SetIntensity]: 'SetIntensity',
};

/** Set `localStorage['happy-dglab-debug'] = 'true'` to trace the wire protocol. */
function tracing(): boolean {
  try {
    return window.localStorage.getItem('happy-dglab-debug') === 'true';
  } catch {
    return false;
  }
}

function trace(...args: unknown[]): void {
  if (tracing()) console.debug(...args);
}

type Listener<T> = (value: T) => void;

/**
 * Controller side of the DG-Lab V4 relay protocol.
 *
 * Owns the WebSocket, the request/response correlation and the device cache. It
 * knows nothing about funscripts — `CoyoteBackend` sits on top of it.
 */
export class DglabV4Socket {
  private ws: WebSocket | null = null;
  private state: DglabSocketState = 'disconnected';
  private url = '';
  /** Our relay client id; the DG-Lab app pairs by passing this back as `tid`. */
  private clientId: string | null = null;
  private readonly attachedApps = new Set<string>();
  private readonly deviceCache = new Map<string, V4Device>();
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private reqCounter = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private refreshTimer: number | null = null;
  private closedByUser = false;
  private readonly loggedOnce = new Set<string>();
  private readonly sentLog = new Map<string, { what: string; body: string }>();

  private readonly stateListeners: Array<Listener<DglabSocketState>> = [];
  private readonly deviceListeners: Array<Listener<V4Device[]>> = [];

  onStateChange(l: Listener<DglabSocketState>): void { this.stateListeners.push(l); }
  onDevicesChange(l: Listener<V4Device[]>): void { this.deviceListeners.push(l); }

  get connectionState(): DglabSocketState { return this.state; }
  /** Value the DG-Lab app must pass as `?tid=`; null until the relay says hello. */
  get targetId(): string | null { return this.clientId; }
  get appCount(): number { return this.attachedApps.size; }
  get devices(): V4Device[] { return [...this.deviceCache.values()]; }

  connect(url: string): void {
    if (this.state === 'connecting' || this.state === 'connected') return;
    this.url = url;
    this.closedByUser = false;
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearReconnect();
    this.stopDeviceRefresh();
    this.ws?.close();
    this.ws = null;
    this.clientId = null;
    this.attachedApps.clear();
    this.deviceCache.clear();
    this.setState('disconnected');
    this.emitDevices();
  }

  /** Send a request and wait for its response. Only for short-lived methods. */
  private requestWithId(reqId: string, message: AppMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.sendToApps(message)) {
        reject(new Error('not connected'));
        return;
      }
      const timer = window.setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timer });
    });
  }

  /**
   * Send a request without awaiting it.
   *
   * `device.op` responses are long-lived — they only arrive once the task ends —
   * so awaiting them in the hot path would leak a promise per tick.
   */
  send(build: (reqId: string) => AppMessage): void {
    const reqId = this.nextReqId();
    const message = build(reqId);
    this.remember(reqId, message);
    this.sendToApps(message);
  }

  /** Keeps a short trail of what was sent, so an error response can name its request. */
  private remember(reqId: string, message: AppMessage): void {
    if (message.t !== 'req') return;
    const data = message.data as { t?: unknown } | undefined;
    const action = typeof data?.t === 'number' ? ACTION_NAMES[data.t] ?? `action ${data.t}` : '';
    this.sentLog.set(reqId, {
      what: action ? `${message.m} ${action}` : message.m,
      body: JSON.stringify(message),
    });
    if (this.sentLog.size > SENT_LOG_LIMIT) {
      this.sentLog.delete(this.sentLog.keys().next().value as string);
    }
  }

  /** Re-read the device list from the app. */
  refreshDevices(): void {
    if (this.attachedApps.size === 0) return;
    const reqId = this.nextReqId();
    trace('[dglab] -> devices.get');
    void this.requestWithId(reqId, buildDevicesGet(reqId))
      .then((result) => this.applySnapshot(result))
      .catch((err) => console.warn('[dglab] devices.get failed:', err.message));
  }

  private startDeviceRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setInterval(() => this.refreshDevices(), DEVICE_REFRESH_MS);
  }

  private stopDeviceRefresh(): void {
    if (this.refreshTimer === null) return;
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private nextReqId(): string {
    this.reqCounter += 1;
    return `r${this.reqCounter}`;
  }

  private open(): void {
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.setState('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
    };
    ws.onmessage = (event) => this.handleFrame(event.data);
    ws.onerror = () => {
      if (this.state !== 'connected') this.setState('error');
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clientId = null;
      this.attachedApps.clear();
      this.stopDeviceRefresh();
      this.deviceCache.clear();
      this.emitDevices();
      this.rejectAllPending('connection closed');
      if (this.closedByUser) {
        this.setState('disconnected');
        return;
      }
      this.setState('error');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  private sendToApps(message: AppMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.attachedApps.size === 0) return false;
    // No `clientId` means "broadcast to every attached app", which is what we want:
    // a single DG-Lab app is the normal case and multiple apps should stay in sync.
    this.ws.send(JSON.stringify({ type: 'message', data: message }));
    return true;
  }

  private handleFrame(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!isRelayFrame(parsed)) {
      console.warn('[dglab] <- unrecognised frame', parsed);
      return;
    }
    const frame: RelayFrame = parsed;
    // `message` frames are logged by handleAppMessage, which can throttle by content.
    if (frame.type !== 'heartbeat' && frame.type !== 'message') trace('[dglab] <-', frame);

    switch (frame.type) {
      case 'hello':
        this.clientId = frame.clientId;
        this.setState('connected');
        break;
      case 'client_attached':
        this.attachedApps.add(frame.clientId);
        this.refreshDevices();
        this.startDeviceRefresh();
        break;
      case 'client_disconnected':
        this.attachedApps.delete(frame.clientId);
        if (this.attachedApps.size === 0) {
          this.stopDeviceRefresh();
          this.deviceCache.clear();
          this.emitDevices();
        }
        break;
      case 'message':
        this.handleAppMessage(frame.data);
        break;
      default:
        break;
    }
  }

  private handleAppMessage(data: unknown): void {
    if (!isAppMessage(data)) {
      console.warn('[dglab] app payload has no recognisable envelope', data);
      return;
    }

    if (data.t === 'resp') {
      const entry = this.pending.get(data.reqId);
      if (!entry) {
        // Fire-and-forget `device.op` replies land here; only the first of each kind is useful.
        if (data.error) {
          const sent = this.sentLog.get(data.reqId);
          const what = sent?.what ?? 'unknown request';
          this.logOnce(`resp:${String(data.error)}:${what}`, `[dglab] ${what} rejected:`, data.error, sent?.body ?? '');
        }
        return;
      }
      this.pending.delete(data.reqId);
      window.clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(String(data.error)));
      else entry.resolve(data.result);
      return;
    }

    if (data.t !== 'ev') return;

    const payload = eventPayload(data);
    switch (eventName(data)) {
      case 'devices.snapshot':
        this.applySnapshot(payload);
        break;
      case 'devices.patch':
        this.applyDevicePatch(payload);
        break;
      case 'slots.patch':
        this.applySlotsPatch(payload);
        break;
      default:
        console.warn('[dglab] unhandled event', eventName(data), data);
        break;
    }
  }

  private applySnapshot(payload: unknown): void {
    const devices = parseDeviceList(payload);
    trace('[dglab] raw device list:', JSON.stringify(payload));
    if (devices.length === 0) console.warn('[dglab] no devices found in the app payload');
    else trace('[dglab] devices', devices.map((d) => `${d.id} (${d.type})`));
    this.deviceCache.clear();
    for (const device of devices) this.deviceCache.set(device.id, device);
    this.emitDevices();
  }

  private applyDevicePatch(payload: unknown): void {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    if (!record) return;

    for (const device of parseDeviceList(record.added)) this.deviceCache.set(device.id, device);
    const removed = Array.isArray(record.removed) ? record.removed : [];
    for (const entry of removed) {
      const id = typeof entry === 'string' ? entry : parseDevice(entry)?.id;
      if (id) this.deviceCache.delete(id);
    }
    this.emitDevices();
  }

  private applySlotsPatch(payload: unknown): void {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    const slots = Array.isArray(record?.slots) ? record.slots : null;
    if (!slots) return;

    let changed = false;
    for (const entry of slots) {
      const patch = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      const slotId = patch?.slotId;
      if (typeof slotId !== 'string') continue;
      const device = this.deviceCache.get(slotId);
      if (!device) continue;

      this.deviceCache.set(slotId, {
        ...device,
        props: { ...device.props, ...(patch.props as object | undefined) },
        slotState: mergeSlotState(device.slotState, patch.slotState),
      });
      changed = true;
    }
    if (changed) this.emitDevices();
  }

  /** Logs a given kind of message only the first time it occurs. */
  private logOnce(key: string, ...args: unknown[]): void {
    if (this.loggedOnce.has(key)) return;
    this.loggedOnce.add(key);
    console.warn(...args);
  }

  private rejectAllPending(reason: string): void {
    for (const [, entry] of this.pending) {
      window.clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private setState(next: DglabSocketState): void {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.stateListeners) l(next);
  }

  private emitDevices(): void {
    const snapshot = this.devices;
    for (const l of this.deviceListeners) l(snapshot);
  }
}
