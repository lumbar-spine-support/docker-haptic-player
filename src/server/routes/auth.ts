import crypto from 'crypto';
import express, { Router } from 'express';
import { Config } from '../config';
import { HttpError } from '../utils/errorHandler';
import { createLoginThrottle } from '../middleware/loginThrottle';
import { COOKIE_NAME, COOKIE_MAX_AGE_MS, cookieOptions, isAuthenticated, readToken } from '../middleware/auth';
import type { TokenStore } from '../services/tokenStore';
import { clientAddress, clientUserAgent } from '../utils/clientAddress';
import { createLogger } from '../utils/logger';

export const TAG = '[auth-route]';

const log = createLogger(TAG);

function matchesPassword(expected: string, received: unknown): boolean {
    if (typeof received !== 'string') return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export function createAuthRouter(config: Config.ServerConfig, store: TokenStore): Router {
    const router = Router();
    const throttle = createLoginThrottle();
    const required = config.password !== '';

    // Scoped to this router so the rest of the app stays body-parser free.
    router.use(express.json({ limit: '1kb' }));

    router.get('/status', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ required, authenticated: !required || isAuthenticated(req, store) });
    });

    router.post('/login', throttle.middleware, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');

        if (!required) {
            res.json({ ok: true });
            return;
        }

        if (!matchesPassword(config.password, req.body?.password)) {
            throttle.recordFailure(req);
            log.warn(`Failed login from ${clientAddress(req)} (${clientUserAgent(req)})`);
            throw new HttpError(401, 'Invalid password');
        }

        throttle.reset(req);
        const token = store.issue(String(req.headers['user-agent'] ?? 'unknown'));
        log.info(`Successful login from ${clientAddress(req)} (${clientUserAgent(req)})`);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: COOKIE_MAX_AGE_MS });
        res.json({ ok: true });
    });

    router.post('/logout', (req, res) => {
        const token = readToken(req);
        if (token) store.revoke(token);
        log.info(`Logout from ${clientAddress(req)} (${clientUserAgent(req)})`);
        res.clearCookie(COOKIE_NAME, cookieOptions(req));
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true });
    });

    return router;
}
