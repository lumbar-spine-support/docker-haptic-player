// Per-IP backoff for the login endpoint. Kept in-process because the app is commonly
// exposed directly on a LAN with no reverse proxy to enforce rate limits.

import type { Request, RequestHandler } from 'express';
import { HttpError } from '../utils/errorHandler';
import { createLogger } from '../utils/logger';

export const TAG = '[login-throttle]';

const log = createLogger(TAG);

export const MAX_ATTEMPTS = 5;
export const BASE_BLOCK_MS = 60 * 1000;
export const MAX_BLOCK_MS = 15 * 60 * 1000;
const ENTRY_TTL_MS = 60 * 60 * 1000;

interface Attempt {
    count: number;
    blocks: number;
    blockedUntil: number;
    updatedAt: number;
}

export interface LoginThrottle {
    middleware: RequestHandler;
    recordFailure(req: Request): void;
    reset(req: Request): void;
}

export function createLoginThrottle(): LoginThrottle {
    const attempts = new Map<string, Attempt>();

    // Lazy eviction keeps the map from growing without bound under a distributed attack.
    function sweep(now: number): void {
        for (const [key, entry] of attempts) {
            if (now - entry.updatedAt > ENTRY_TTL_MS && entry.blockedUntil <= now) {
                attempts.delete(key);
            }
        }
    }

    function keyOf(req: Request): string {
        return req.ip ?? req.socket.remoteAddress ?? 'unknown';
    }

    return {
        middleware(req, _res, next) {
            const now = Date.now();
            sweep(now);

            const entry = attempts.get(keyOf(req));
            if (entry && entry.blockedUntil > now) {
                const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
                log.warn(`Blocked login attempt from ${keyOf(req)}, ${retryAfter}s remaining`);
                _res.setHeader('Retry-After', String(retryAfter));
                next(new HttpError(429, `Too many login attempts, retry in ${retryAfter} seconds`));
                return;
            }

            next();
        },

        recordFailure(req: Request): void {
            const now = Date.now();
            const key = keyOf(req);
            const entry = attempts.get(key) ?? { count: 0, blocks: 0, blockedUntil: 0, updatedAt: now };

            entry.count += 1;
            entry.updatedAt = now;

            if (entry.count >= MAX_ATTEMPTS) {
                entry.count = 0;
                entry.blocks += 1;
                entry.blockedUntil = now + Math.min(BASE_BLOCK_MS * 2 ** (entry.blocks - 1), MAX_BLOCK_MS);
                log.warn(`${MAX_ATTEMPTS} failed login attempts from ${key}, blocking for ${Math.round((entry.blockedUntil - now) / 1000)}s`);
            }

            attempts.set(key, entry);
        },

        reset(req: Request): void {
            attempts.delete(keyOf(req));
        },
    };
}
