// Shared test helpers for server integration tests. Reduces boilerplate across test files.

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { Express } from 'express';
import { Config } from '../../src/server/config';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/media');

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
    createAppFn?: (config: Config.ServerConfig) => Express,
): Promise<{ port: number; config: Config.ServerConfig; mediaDir: string; close: () => Promise<void> }> {
    const testMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'));
    copyFixtures(testMediaDir);

    const config: Config.ServerConfig = {
        ...Config.DEFAULT_SERVER_CONFIG,
        mediaDir: testMediaDir,
    };

    const { createApp } = await import('../../src/server/index');
    const app = createAppFn ? createAppFn(config) : createApp(config);

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
        mediaDir: testMediaDir,
        close: async () => {
            return new Promise((resolve) => {
                server.close(() => {
                    fs.rmSync(testMediaDir, { recursive: true, force: true });
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
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; body: unknown }> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path: pathname,
            method: 'GET',
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
): Promise<{ status: number; headers: http.IncomingHttpHeaders; buffer: Buffer }> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path: pathname,
            method: 'GET',
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
