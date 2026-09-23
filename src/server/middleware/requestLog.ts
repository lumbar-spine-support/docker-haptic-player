// Connection logging. Every request is only interesting while debugging, so the info level is
// limited to a client showing up for the first time (or after it went quiet for a while).

import type { RequestHandler } from 'express';
import { clientAddress, clientUserAgent } from '../utils/clientAddress';
import { createLogger } from '../utils/logger';

export const TAG = '[request]';

const log = createLogger(TAG);

/** A client that sent nothing for this long is logged as a new connection again. */
export const CLIENT_IDLE_MS = 30 * 60 * 1000;

export function createRequestLogger(): RequestHandler {
    const lastSeen = new Map<string, number>();

    return (req, res, next) => {
        const address = clientAddress(req);
        const userAgent = clientUserAgent(req);
        const key = `${address}\0${userAgent}`;
        const now = Date.now();

        const previous = lastSeen.get(key);
        if (previous === undefined || now - previous > CLIENT_IDLE_MS) {
            log.info(`Client connected: ${address} (${userAgent})`);
            // Bounded cleanup, piggybacked on the rare new-connection path.
            for (const [seenKey, seenAt] of lastSeen) {
                if (now - seenAt > CLIENT_IDLE_MS) lastSeen.delete(seenKey);
            }
        }
        lastSeen.set(key, now);

        if (!log.isDebug()) {
            next();
            return;
        }

        const started = now;
        res.on('finish', () => {
            log.debug(`${address} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
        });

        next();
    };
}
