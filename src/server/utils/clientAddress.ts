// Shared request identity helpers used by the log lines about clients.

import type { Request } from 'express';

/** Remote address as express resolved it, honouring the configured trust proxy setting. */
export function clientAddress(req: Request): string {
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function clientUserAgent(req: Request): string {
    return String(req.headers['user-agent'] ?? 'unknown');
}
