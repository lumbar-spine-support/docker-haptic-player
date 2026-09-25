import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { Config } from '../../src/server/config';
import { DEFAULT_LOG_LEVEL, getLogLevel } from '../../src/server/utils/logger';

const TAG = Config.TAG;
const DEFAULTS = Config.DEFAULTS;

/** Runs `fn` with CONFIG_PATH pointed at a fresh temp directory, restoring the env var afterwards. */
async function withConfigPath(fn: (configPath: string) => void | Promise<void>): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const configPath = Config.settingsFilePath(dir);
    const originalConfigPath = process.env.CONFIG_PATH;
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = () => { };
    console.log = () => { };
    process.env.CONFIG_PATH = dir;
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

test(`${TAG} CONFIG_PATH names the directory holding settings.yaml and tokens.txt`, async () => {
    await withConfigPath((configPath) => {
        const config = Config.load();
        const dir = path.dirname(configPath);
        assert.equal(config.server.configDir, dir);
        assert.equal(Config.settingsFilePath(dir), configPath);
        assert.equal(Config.tokenFilePath(dir), path.join(dir, 'tokens.txt'));
    });
});

test(`${TAG} a CONFIG_PATH still pointing at settings.yaml falls back to its directory`, async () => {
    await withConfigPath((configPath) => {
        process.env.CONFIG_PATH = configPath;
        const config = Config.load();
        assert.equal(config.server.configDir, path.dirname(configPath));
    });
});

test(`${TAG} the generated settings.yaml contains no key without an env name`, async () => {
    await withConfigPath((configPath) => {
        Config.load();
        assert.doesNotMatch(fs.readFileSync(configPath, 'utf-8'), /^undefined:/m);
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

test(`${TAG} LOG_LEVEL is applied to the logger and invalid values fall back to the default`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'LOG_LEVEL: debug\n', 'utf-8');
        assert.equal(Config.load().server.logLevel, 'debug');
        assert.equal(getLogLevel(), 'debug');

        process.env.LOG_LEVEL = 'chatty';
        try {
            assert.equal(Config.load().server.logLevel, DEFAULT_LOG_LEVEL);
            assert.equal(getLogLevel(), DEFAULT_LOG_LEVEL);
        } finally {
            delete process.env.LOG_LEVEL;
        }
    });
});

test(`${TAG} DGLAB_ENABLED defaults to off`, async () => {
    await withConfigPath(() => {
        assert.equal(Config.load().client.dglabEnabled, false);
    });
});

test(`${TAG} a boolean setting accepts the usual truthy spellings from the environment`, async () => {
    for (const [raw, expected] of [['true', true], ['1', true], ['yes', true], ['on', true],
    ['false', false], ['0', false], ['no', false], ['', false]] as const) {
        await withConfigPath(() => {
            process.env.DGLAB_ENABLED = raw;
            try {
                assert.equal(Config.load().client.dglabEnabled, expected, `for ${JSON.stringify(raw)}`);
            } finally {
                delete process.env.DGLAB_ENABLED;
            }
        });
    }
});

test(`${TAG} a quoted boolean in settings.yaml is still coerced to a boolean`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'DGLAB_ENABLED: "true"\n', 'utf-8');
        assert.equal(Config.load().client.dglabEnabled, true);
    });
});