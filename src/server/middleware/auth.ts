// Blocks every request that has no valid access token, including the SPA shell and its bundle.
// Mounted before express.static so no application asset reaches an unauthenticated client.

import type { Request, RequestHandler, Response } from 'express';
import { Config } from '../config';
import { parseCookies } from '../utils/cookies';
import { clientAddress } from '../utils/clientAddress';
import { createLogger } from '../utils/logger';
import type { TokenStore } from '../services/tokenStore';

export const TAG = '[auth]';

const log = createLogger(TAG);

export const COOKIE_NAME = 'happy_token';

export const COOKIE_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// Third-party assets and the login page itself must load before a token exists.
const PUBLIC_PREFIXES = ['/api/auth', '/auth', '/vendor', '/icon.svg', '/favicon.ico'];

export const LOGIN_PATH = '/auth/';

function isPublicPath(pathname: string): boolean {
    return PUBLIC_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`));
}

export function readToken(req: Request): string | undefined {
    return parseCookies(req.headers.cookie)[COOKIE_NAME];
}

export function isAuthenticated(req: Request, store: TokenStore): boolean {
    return store.verify(readToken(req));
}

/** Cookies flagged Secure are dropped by browsers over plain HTTP, so follow the actual scheme. */
export function cookieOptions(req: Request) {
    return {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: req.secure,
    };
}

function denyRequest(req: Request, res: Response): void {
    res.setHeader('Cache-Control', 'no-store');

    // Only real browser navigations get a redirect; req.accepts() would also match header-less API calls.
    const isNavigation = req.method === 'GET'
        && !req.path.startsWith('/api/')
        && (req.headers.accept ?? '').includes('text/html');

    if (isNavigation) {
        log.info(`Unauthenticated navigation from ${clientAddress(req)} to ${req.originalUrl}, redirecting to the login page`);
        res.redirect(302, `${LOGIN_PATH}?returnTo=${encodeURIComponent(req.originalUrl)}`);
        return;
    }

    log.debug(`Rejected unauthenticated ${req.method} ${req.originalUrl} from ${clientAddress(req)}`);
    res.status(401).json({ error: 'Authentication required' });
}

export function createAuthMiddleware(config: Config.ServerConfig, store: TokenStore): RequestHandler {
    if (!config.password) {
        log.warn('No password configured, authentication is disabled.');
        return (_req, _res, next) => next();
    }

    log.info('Password authentication is enabled.');

    return (req, res, next) => {
        if (isPublicPath(req.path) || isAuthenticated(req, store)) {
            next();
            return;
        }

        denyRequest(req, res);
    };
}
