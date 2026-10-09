// Shared test helpers for server integration tests. Reduces boilerplate across test files.

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { HappyApp } from '../../src/server/index';
import { Config } from '../../src/server/config';

export interface RequestOptions {
    headers?: Record<string, string>;
}

function requestHeaders(opts?: RequestOptions): Record<string, string> {
    return { ...(opts?.headers ?? {}) };
}

// Start a test server with a temporary config directory.
export async function startTestServer(
    createAppFn?: (config: Config.ServerConfig) => HappyApp,
    overrides?: Partial<Config.ServerConfig>,
    clientOverrides?: Partial<Config.ClientConfig>,
): Promise<{ port: number; config: Config.ServerConfig; close: () => Promise<void> }> {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-config-'));

    const config: Config.ServerConfig = {
        ...Config.DEFAULT_SERVER_CONFIG,
        configDir,
        ...overrides,
    };
    const clientConfig = {
        ...Config.DEFAULT_CLIENT_CONFIG,
        ...clientOverrides,
    } as Config.ClientConfig;

    const { createApp } = await import('../../src/server/index');
    const app = createAppFn
        ? createAppFn(config)
        : createApp(config, clientConfig);

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

    return {
        port: addr.port,
        config,
        close: async () => {
            return new Promise((resolve) => {
                server.closeAllConnections?.();
                server.close(() => {
                    fs.rmSync(configDir, { recursive: true, force: true });
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
