export type WsScheme = 'ws://' | 'wss://';

export interface IntifaceAddress {
    scheme: WsScheme;
    host: string;
}

export const DEFAULT_INTIFACE_ADDRESS: IntifaceAddress = { scheme: 'ws://', host: 'localhost:12345' };

/**
 * Split user input into scheme and host. A `ws://`/`wss://` prefix in the input wins over
 * `scheme`, so pasting a full URL works; an empty host falls back to the default.
 */
export function parseIntifaceAddress(raw: string, scheme: WsScheme = DEFAULT_INTIFACE_ADDRESS.scheme): IntifaceAddress {
    const trimmed = raw.trim();
    const match = /^(wss?):\/\//i.exec(trimmed);
    const resolvedScheme: WsScheme = match ? (match[1].toLowerCase() === 'wss' ? 'wss://' : 'ws://') : scheme;
    const host = trimmed.slice(match ? match[0].length : 0).replace(/^\/+/, '');
    return { scheme: resolvedScheme, host: host || DEFAULT_INTIFACE_ADDRESS.host };
}

export function formatIntifaceAddress(address: IntifaceAddress): string {
    return `${address.scheme}${address.host}`;
}
