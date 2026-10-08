import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

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
        assert.equal(config.client.jellyfinUrl, DEFAULTS.jellyfinUrl);
        assert.equal(config.client.videoSeekInterval, DEFAULTS.videoSeekInterval);
        assert.deepEqual(config.client.chapterSourcePriority, DEFAULTS.chapterSourcePriority);
    });
});

test(`${TAG} a newly created settings.yaml is seeded with environment variable overrides`, async () => {
    const env = { PORT: '8123', JELLYFIN_URL: 'https://jellyfin.example.com', DEFAULT_BLUR_CONTENT: 'true', CHAPTER_SOURCE_PRIORITY: 'funscript, embedded' };
    const original = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try {
        await withConfigPath((configPath) => {
            assert.equal(fs.existsSync(configPath), false);
            const config = Config.load();
            assert.equal(config.server.port, 8123);
            assert.equal(config.client.jellyfinUrl, 'https://jellyfin.example.com');
            assert.equal(config.client.blurContent, true);
            assert.deepEqual(config.client.chapterSourcePriority, ['funscript', 'embedded']);

            const written = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
            assert.equal(written.PORT, 8123);
            assert.equal(written.JELLYFIN_URL, 'https://jellyfin.example.com');
            assert.equal(written.DEFAULT_BLUR_CONTENT, true);
            assert.deepEqual(written.CHAPTER_SOURCE_PRIORITY, ['funscript', 'embedded']);
            assert.equal(written.DEFAULT_HAPTIC_FREQUENCY, DEFAULTS.hapticFrequency);
        });
    } finally {
        for (const [k, v] of Object.entries(original)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
});

test(`${TAG} CONFIG_PATH names the directory holding settings.yaml`, async () => {
    await withConfigPath((configPath) => {
        const config = Config.load();
        const dir = path.dirname(configPath);
        assert.equal(config.server.configDir, dir);
        assert.equal(Config.settingsFilePath(dir), configPath);
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
        fs.writeFileSync(configPath, 'PORT: 8080\nJELLYFIN_URL: https://jellyfin.example.com/\n', 'utf-8');
        const config = Config.load();
        assert.equal(config.server.port, 8080);
        assert.equal(config.client.jellyfinUrl, 'https://jellyfin.example.com', 'trailing slash trimmed');
        assert.equal(config.client.videoSeekInterval, DEFAULTS.videoSeekInterval);
    });
});

test(`${TAG} a blank JELLYFIN_URL in settings.yaml stays empty`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'JELLYFIN_URL:\n', 'utf-8');
        assert.equal(Config.load().client.jellyfinUrl, '');
    });
});

test(`${TAG} load falls back to defaults when settings.yaml is malformed`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'PORT: [1, 2\nunterminated: "oops', 'utf-8');
        const config = Config.load();
        assert.equal(config.server.port, DEFAULTS.port);
        assert.equal(config.client.jellyfinUrl, DEFAULTS.jellyfinUrl);
    });
});

test(`${TAG} load both from environment variables and settings.yaml`, async () => {
    await withConfigPath((configPath) => {
        fs.writeFileSync(configPath, 'PORT: 8080\nJELLYFIN_URL: https://shouldbeoverridden.example.com', 'utf-8');
        process.env.JELLYFIN_URL = 'https://jellyfin.example.com';
        const config = Config.load();
        assert.equal(config.server.port, 8080);
        assert.equal(config.client.jellyfinUrl, 'https://jellyfin.example.com');
        assert.equal(config.client.videoSeekInterval, DEFAULTS.videoSeekInterval);
        delete process.env.JELLYFIN_URL;
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