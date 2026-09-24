// Clean-room implementation of the DG-Lab V4 wire format, written from the public
// protocol documentation. Pure data and pure functions only, so it is unit-testable
// without a WebSocket.

/** Frames exchanged with the relay itself. `data` is opaque to the relay. */
export type RelayFrame =
  | { type: 'hello'; clientId: string }
  | { type: 'client_attached'; clientId: string }
  | { type: 'client_disconnected'; clientId: string }
  | { type: 'controller_attached'; clientId: string }
  | { type: 'controller_disconnected'; clientId: string }
  | { type: 'message'; clientId: string; data: unknown }
  | { type: 'heartbeat' }
  | { type: 'pong'; ts: number }
  | { type: 'idle_timeout' }
  | { type: 'error'; code: string; clientId?: string };

/** Application-layer envelope carried inside a relay `message` frame. */
export type AppMessage =
  | { t: 'req'; reqId: string; m: string; data?: unknown }
  | { t: 'resp'; reqId: string; result?: unknown; error?: unknown }
  | { t: 'ev'; m?: string; e?: string; ev?: string; data?: unknown;[key: string]: unknown };

export const V4ActionType = {
  AppendPulseData: 0,
  AddIntensity: 3,
  SetTempIntensity: 4,
  SetIntensity: 7,
} as const;

export const V4Channel = { A: 0, B: 1 } as const;
export type V4ChannelId = (typeof V4Channel)[keyof typeof V4Channel];

/** Pulse frame encoding version; 3 is the Coyote 3.0 `[freq×4, intensity×4]` layout. */
const PULSE_VERSION = 3;

/** Priority is a strict `0 | 1 | 2`; anything else is rejected as `invalid_operate`. */
const DEFAULT_PRIORITY = 1;

export interface V4ChannelState {
  isMuted?: boolean;
  warmUpScale?: number;
  intensityMax?: number;
  comfortLimit?: { comfortMax?: number; absoluteMax?: number;[key: string]: unknown };
  [key: string]: unknown;
}

export interface V4SlotState {
  channelA?: V4ChannelState;
  channelB?: V4ChannelState;
  [key: string]: unknown;
}

export interface V4Device {
  /** Slot id used as `s` in every `device.op`. */
  id: string;
  type: string;
  props?: {
    power?: number;
    version?: number | string;
    connectState?: number | string;
    channelAStatus?: number;
    channelBStatus?: number;
    [key: string]: unknown;
  };
  slotState?: V4SlotState;
}

export function isRelayFrame(value: unknown): value is RelayFrame {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

export function isAppMessage(value: unknown): value is AppMessage {
  return !!value && typeof value === 'object' && typeof (value as { t?: unknown }).t === 'string';
}

/** Event name; the wire uses `ev`, with `m`/`e` accepted as documented variants. */
export function eventName(message: AppMessage & { t: 'ev' }): string {
  return message.ev ?? message.m ?? message.e ?? '';
}

/** Events put their payload inline on the envelope rather than nesting it under `data`. */
export function eventPayload(message: AppMessage & { t: 'ev' }): unknown {
  return message.data ?? message;
}

export function buildRequest(reqId: string, method: string, data?: unknown): AppMessage {
  return data === undefined ? { t: 'req', reqId, m: method } : { t: 'req', reqId, m: method, data };
}

export function buildDevicesGet(reqId: string): AppMessage {
  return buildRequest(reqId, 'devices.get');
}

/**
 * Continuous absolute strength.
 *
 * `SetIntensity` only accepts 0, so absolute values go through `SetTempIntensity`.
 * The task auto-resets to zero after `durationMs`, which doubles as a dead-man's
 * switch: stop resending and the device falls silent on its own.
 */
export function buildSetTempIntensity(
  reqId: string,
  slotId: string,
  channel: V4ChannelId,
  value: number,
  durationMs: number,
): AppMessage {
  return buildRequest(reqId, 'device.op', {
    s: slotId,
    t: V4ActionType.SetTempIntensity,
    c: channel,
    v: Math.max(0, Math.round(value)),
    d: Math.max(1, Math.round(durationMs)),
    p: DEFAULT_PRIORITY,
    im: true,
  });
}

/**
 * Queue pulse frames, replacing whatever was queued before.
 *
 * `im: true` is essential: the device consumes one frame per ~100 ms tick, so a
 * batch that merely appends builds an ever-growing backlog and the device ends up
 * playing minutes-old data.
 */
export function buildAppendPulseData(
  reqId: string,
  slotId: string,
  channel: V4ChannelId,
  frames: string[],
  durationMs: number,
  seq: number,
): AppMessage {
  return buildRequest(reqId, 'device.op', {
    s: slotId,
    t: V4ActionType.AppendPulseData,
    c: channel,
    v: frames,
    ver: PULSE_VERSION,
    seq,
    d: Math.max(1, Math.round(durationMs)),
    p: DEFAULT_PRIORITY,
    im: true,
  });
}

/** Hard reset of a channel's base intensity. `SetIntensity` accepts no other value. */
export function buildResetIntensity(reqId: string, slotId: string, channel: V4ChannelId): AppMessage {
  return buildRequest(reqId, 'device.op', {
    s: slotId,
    t: V4ActionType.SetIntensity,
    c: channel,
    v: 0,
    p: DEFAULT_PRIORITY,
  });
}

/** Cancel every running task on a slot. */
export function buildClear(reqId: string, slotId: string): AppMessage {
  return buildRequest(reqId, 'device.op.clear', { s: slotId });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Normalise a device entry, tolerating the snapshot/patch shape differences.
 *
 * `id` is the slot id, because that is what every `device.op` echoes back as `s`.
 * A device's own identifier is deliberately not used: the two differ, and the app
 * answers `slot_not_found` when the wrong one is sent.
 */
export function parseDevice(value: unknown): V4Device | null {
  const record = asRecord(value);
  if (!record) return null;
  const rawId = record.slotId ?? record.slot ?? record.s ?? record.sid ?? record.id ?? record.deviceId;
  // Slot ids are sometimes numeric, including a legitimate slot 0.
  const id = typeof rawId === 'number' ? String(rawId) : rawId;
  if (typeof id !== 'string' || id.length === 0) return null;
  return {
    id,
    type: typeof record.type === 'string' ? record.type : 'unknown',
    props: asRecord(record.props) ?? undefined,
    slotState: asRecord(record.slotState) ?? asRecord(record.state) ?? undefined,
  };
}

/** Devices carried by a `devices.snapshot` or the `added` half of a `devices.patch`. */
export function parseDeviceList(value: unknown): V4Device[] {
  const list = Array.isArray(value) ? value : asRecord(value)?.devices;
  if (!Array.isArray(list)) return [];
  return list.map(parseDevice).filter((d): d is V4Device => d !== null);
}

/**
 * Merge a `slots.patch` payload into a device.
 *
 * The merge recurses to any depth: patches are partial at every level, and
 * `channelA.comfortLimit` in particular arrives with only the changed field. A
 * shallow merge silently drops `comfortMax`, which would raise the safety ceiling.
 */
export function mergeSlotState(current: V4SlotState | undefined, patch: unknown): V4SlotState {
  return deepMerge(current ?? {}, patch) as V4SlotState;
}

function deepMerge(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  const incoming = asRecord(patch);
  if (!incoming) return base;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const nested = asRecord(value);
    const existing = asRecord(merged[key]);
    merged[key] = nested && existing ? deepMerge(existing, nested) : value;
  }
  return merged;
}

/** Build the deep link that hands a relay URL to the DG-Lab 4 app. */
export function pairingDeepLink(wsUrl: string): string {
  return `https://dungeon-lab.cn/s/?v=1&action=socket&url=${encodeURIComponent(wsUrl)}`;
}
