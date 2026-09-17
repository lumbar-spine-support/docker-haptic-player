import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { Config } from '../../src/server/config';

const TAG = Config.TAG;
const DEFAULTS = Config.DEFAULTS;

/** Runs `fn` with CONFIG_PATH pointed at a fresh temp file, restoring the env var afterwards. */
async function withConfigPath(fn: (configPath: string) => void | Promise<void>): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const configPath = path.join(dir, 'settings.yaml');
    const originalConfigPath = process.env.CONFIG_PATH;
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = () => { };
    console.log = () => { };
    process.env.CONFIG_PATH = configPath;
    try {
        await fn(configPath);
    } finally {
        if (originalConfigPath === undefined) delete process.env.CONFIG_PATH;
        else process.env.CONFIG_PATH = originalConfigPath;
        console.warn = originalWarn;
        console.log = originalLog;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test(`${TAG} load writes a default settings.yaml and returns built-in defaults when none exists`, async () => {
    await withConfigPath((configPath) => {
        const config = Config.load();
        assert.equal(fs.existsSync(configPath), true);
        assert.equal(config.server.port, DEFAULTS.port);
        assert.equal(config.server.password, DEFAULTS.password);
        assert.equal(config.client.videoSeekInterval, DEFAULTS.videoSeekInterval);
        assert.deepEqual(config.server.ignoreExt, DEFAULTS.ignoreExt);
    });
});

test(`${TAG} load merges a partial settings.yaml on top of the defaults`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'PORT: 8080\nPASSWORD: secret123\n', 'utf-8');
        const config = Config.load();
        assert.equal(config.server.port, 8080);
        assert.equal(config.server.password, 'secret123');
        assert.equal(config.client.videoSeekInterval, DEFAULTS.videoSeekInterval);
    });
});

test(`${TAG} load falls back to defaults when settings.yaml is malformed`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'PORT: [1, 2\nunterminated: "oops', 'utf-8');
        const config = Config.load();
        assert.equal(config.server.port, DEFAULTS.port);
        assert.equal(config.server.password, DEFAULTS.password);
    });
});

test(`${TAG} load both from environment variables and settings.yaml`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'PORT: 8080\nPASSWORD: shouldbeoverridden', 'utf-8');
        process.env.PASSWORD = 'envpassword';
        const config = Config.load();
        assert.equal(config.server.port, 8080);
        assert.equal(config.server.password, 'envpassword');
        assert.equal(config.client.videoSeekInterval, DEFAULTS.videoSeekInterval);
        delete process.env.PASSWORD;
    });
});