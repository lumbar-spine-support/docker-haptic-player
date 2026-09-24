// Shared test helpers for server integration tests. Reduces boilerplate across test files.

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { HappyApp } from '../../src/server/index';
import { Config } from '../../src/server/config';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/media');

// Token seeded by the most recent startTestServer(), attached to requests unless overridden.
let defaultToken: string | null = null;

export interface RequestOptions {
    // null sends no cookie at all, which is how unauthenticated access is tested.
    token?: string | null;
    headers?: Record<string, string>;
}

function requestHeaders(opts?: RequestOptions): Record<string, string> {
    const headers = { ...(opts?.headers ?? {}) };
    const token = opts && 'token' in opts ? opts.token : defaultToken;
    if (token) headers.Cookie = `happy_token=${token}`;
    return headers;
}

// Copy fixture files to a test directory, skipping metadata.
export function copyFixtures(destDir: string): void {
    if (!fs.existsSync(FIXTURES_DIR)) {
        throw new Error(`Fixtures directory not found: ${FIXTURES_DIR}`);
    }

    const files = fs.readdirSync(FIXTURES_DIR);
    for (const file of files) {
        if (file === 'ATTRIBUTION.md') continue;
        const src = path.join(FIXTURES_DIR, file);
        const dest = path.join(destDir, file);
        fs.copyFileSync(src, dest);
    }
}

// Run a test with a temporary media directory populated with fixtures.
export async function withMediaFixtures(
    fn: (dir: string, config: Config.ServerConfig) => Promise<void>,
): Promise<void> {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'));
    try {
        copyFixtures(testDir);
        const config: Config.ServerConfig = {
            ...Config.DEFAULT_SERVER_CONFIG,
            mediaDir: testDir,
        };
        await fn(testDir, config);
    } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
}

// Start a test server with a temporary media directory and fixtures.
export async function startTestServer(
    createAppFn?: (config: Config.ServerConfig) => HappyApp,
    overrides?: Partial<Config.ServerConfig>,
    clientOverrides?: Partial<Config.ClientConfig>,
): Promise<{ port: number; config: Config.ServerConfig; mediaDir: string; tokenFile: string; token: string; close: () => Promise<void> }> {
    const testMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'));
    copyFixtures(testMediaDir);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-config-'));
    const tokenFile = Config.tokenFilePath(configDir);

    const config: Config.ServerConfig = {
        ...Config.DEFAULT_SERVER_CONFIG,
        mediaDir: testMediaDir,
        configDir,
        ...overrides,
    };
    const clientConfig: Config.ClientConfig = {
        ...Config.DEFAULT_CLIENT_CONFIG,
        ...clientOverrides,
    };

    const { createApp, attachUpgradeHandlers } = await import('../../src/server/index');
    const app = createAppFn ? createAppFn(config) : createApp(config, clientConfig);

    const { createTokenStore } = await import('../../src/server/services/tokenStore');
    const token = createTokenStore(tokenFile).issue('test');
    defaultToken = token;

    const server = await new Promise<http.Server>((resolve) => {
        const srv = app.listen(0, () => {
            const addr = srv.address();
            if (addr && typeof addr === 'object') {
                resolve(srv);
            } else {
                throw new Error('Failed to get server address');
            }
        });
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') {
        throw new Error('Invalid server address');
    }

    attachUpgradeHandlers(server, app);

    return {
        port: addr.port,
        config,
        mediaDir: testMediaDir,
        tokenFile,
        token,
        close: async () => {
            return new Promise((resolve) => {
                app.dglabRelay?.close();
                server.closeAllConnections?.();
                server.close(() => {
                    fs.rmSync(testMediaDir, { recursive: true, force: true });
                    fs.rmSync(path.dirname(tokenFile), { recursive: true, force: true });
                    resolve();
                });
            });
        },
    };
}

// Make an HTTP GET request to the test server.
export async function httpGet(
    port: number,
    pathname: string,
    opts?: RequestOptions,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; body: unknown }> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path: pathname,
            method: 'GET',
            headers: requestHeaders(opts),
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode || 500,
                        headers: res.headers,
                        text: data,
                        body: JSON.parse(data),
                    });
                } catch {
                    resolve({
                        status: res.statusCode || 500,
                        headers: res.headers,
                        text: data,
                        body: null,
                    });
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// Make an HTTP GET request and collect response as a Buffer.
export async function httpGetBuffer(
    port: number,
    pathname: string,
    opts?: RequestOptions,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; buffer: Buffer }> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path: pathname,
            method: 'GET',
            headers: requestHeaders(opts),
        };

        const req = http.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => {
                chunks.push(chunk as Buffer);
            });
            res.on('end', () => {
                resolve({
                    status: res.statusCode || 500,
                    headers: res.headers,
                    buffer: Buffer.concat(chunks),
                });
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// Make an HTTP POST request with a JSON body.
export async function httpPost(
    port: number,
    pathname: string,
    payload: unknown,
    opts?: RequestOptions,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; body: unknown }> {
    const data = JSON.stringify(payload ?? {});

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path: pathname,
            method: 'POST',
            headers: {
                ...requestHeaders(opts),
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        };

        const req = http.request(options, (res) => {
            let text = '';
            res.on('data', (chunk) => {
                text += chunk;
            });
            res.on('end', () => {
                let body: unknown = null;
                try {
                    body = JSON.parse(text);
                } catch {
                    body = null;
                }
                resolve({ status: res.statusCode || 500, headers: res.headers, text, body });
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Extract the happy_token value from a Set-Cookie response header.
export function tokenFromSetCookie(headers: http.IncomingHttpHeaders): string | null {
    for (const cookie of headers['set-cookie'] ?? []) {
        const match = /^happy_token=([^;]*)/.exec(cookie);
        if (match && match[1]) return decodeURIComponent(match[1]);
    }
    return null;
}
