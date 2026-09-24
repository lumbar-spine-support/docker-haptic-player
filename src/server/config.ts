import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createLogger, DEFAULT_LOG_LEVEL, isLogLevel, LOG_LEVELS, setLogLevel } from './utils/logger';

export namespace Config {

  export const TAG = '[config]';

  const log = createLogger(TAG);

  export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
  export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'flac'];

  export type ConfigEntry = number | string | boolean | string[];

  /** Stores the application configuration. Can be loaded from YAML or environment variables. */
  export interface ServerConfig {
    [key: string]: ConfigEntry;
    port: number;
    mediaDir: string;
    ignoreExt: string[];
    password: string;
    configDir: string;
    trustProxy: number;
    logLevel: string;
    funscriptSuffixSeparator: string;
    funscriptSuffixStroker: string;
    funscriptSuffixButtplug: string;
    funscriptSuffixVibrator: string;
    funscriptSuffixEstim: string;
    funscriptSuffixMachine: string;
  }

  /** Stores the client-side configuration. Can be loaded from YAML or environment variables. */
  export interface ClientConfig {
    [key: string]: ConfigEntry;
    videoSeekInterval: number;
    dglabEnabled: boolean;
  }

  export interface Config {
    server: ServerConfig;
    client: ClientConfig;
  }

  export const DEFAULT_MOUNT = '/config';

  export const SETTINGS_FILE_NAME = 'settings.yaml';

  export const TOKEN_FILE_NAME = 'tokens.txt';

  export const CACHE_DIR_NAME = 'cache';

  export const LIBRARY_CACHE_FILE_NAME = 'library.json';

  export const ARTWORK_CACHE_DIR_NAME = 'artwork';

  /** Path of the settings file inside a config directory. */
  export function settingsFilePath(configDir: string): string {
    return path.join(configDir, SETTINGS_FILE_NAME);
  }

  /** Path of the persisted access token file inside a config directory. */
  export function tokenFilePath(configDir: string): string {
    return path.join(configDir, TOKEN_FILE_NAME);
  }

  /** Root of all derived, disposable data inside a config directory. Safe to delete at any time. */
  export function cacheDirPath(configDir: string): string {
    return path.join(configDir, CACHE_DIR_NAME);
  }

  /** Path of the persisted library index snapshot. */
  export function libraryCacheFilePath(configDir: string): string {
    return path.join(cacheDirPath(configDir), LIBRARY_CACHE_FILE_NAME);
  }

  /** Directory holding extracted cover images, one pair of files per cache key. */
  export function artworkCacheDirPath(configDir: string): string {
    return path.join(cacheDirPath(configDir), ARTWORK_CACHE_DIR_NAME);
  }

  export const DEFAULT_SERVER_CONFIG: ServerConfig = {
    port: 3000,
    mediaDir: '/media',
    ignoreExt: [],
    password: 'happy',
    configDir: DEFAULT_MOUNT,
    trustProxy: 0,
    logLevel: DEFAULT_LOG_LEVEL,
    funscriptSuffixSeparator: '.',
    funscriptSuffixStroker: 'stroker',
    funscriptSuffixButtplug: 'buttplug',
    funscriptSuffixVibrator: 'vibrator',
    funscriptSuffixEstim: 'estim',
    funscriptSuffixMachine: 'machine',
  };

  export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
    videoSeekInterval: 10,
    dglabEnabled: false,
  };

  export const DEFAULTS = { ...DEFAULT_SERVER_CONFIG, ...DEFAULT_CLIENT_CONFIG };

  export const DESCRIPTIONS: Record<string, string> = {
    port: 'HTTP port of the web interface',
    mediaDir: 'Directory that contains media files',
    ignoreExt: 'File extensions to ignore (without leading dot)',
    password: 'Web interface access password. Leave empty to disable authentication',
    trustProxy: 'Number of reverse proxy hops to trust for X-Forwarded-* headers. 0 for direct LAN access, 1 behind nginx/Traefik',
    logLevel: `Verbosity of the console log: ${LOG_LEVELS.join(', ')}`,
    videoSeekInterval: 'Default skip interval in seconds for the seek buttons (TODO: unused)',
    dglabEnabled: 'Enable the experimental DG-Lab Coyote 3.0 relay endpoint and its settings UI',
    funscriptSuffixSeparator: 'Character that separates filename from funscript suffix',
    funscriptSuffixStroker: 'Suffix for stroker funscript files',
    funscriptSuffixButtplug: 'Suffix for buttplug funscript files',
    funscriptSuffixVibrator: 'Suffix for vibrator funscript files',
    funscriptSuffixEstim: 'Suffix for estim funscript files',
    funscriptSuffixMachine: 'Suffix for machine funscript files',
  };

  export const ENV_NAMES: Record<string, string> = {
    port: 'PORT',
    mediaDir: 'MEDIA_DIR',
    ignoreExt: 'IGNORE_EXT',
    password: 'PASSWORD',
    trustProxy: 'TRUST_PROXY',
    logLevel: 'LOG_LEVEL',
    videoSeekInterval: 'VIDEO_SEEK_INTERVAL',
    dglabEnabled: 'DGLAB_ENABLED',
    funscriptSuffixSeparator: 'FUNSCRIPT_SUFFIX_SEPARATOR',
    funscriptSuffixStroker: 'FUNSCRIPT_SUFFIX_STROKER',
    funscriptSuffixButtplug: 'FUNSCRIPT_SUFFIX_BUTTPLUG',
    funscriptSuffixVibrator: 'FUNSCRIPT_SUFFIX_VIBRATOR',
    funscriptSuffixEstim: 'FUNSCRIPT_SUFFIX_ESTIM',
    funscriptSuffixMachine: 'FUNSCRIPT_SUFFIX_MACHINE',
  };

  // Infer which env vars belong to which config from the default config objects
  const SERVER_KEYS = new Set(Object.keys(DEFAULT_SERVER_CONFIG));
  const CLIENT_KEYS = new Set(Object.keys(DEFAULT_CLIENT_CONFIG));

  /** Convert a string value to the appropriate type based on the target object's property type. */
  function applyConfigValue(config: ServerConfig | ClientConfig, key: string, stringValue: string): void {
    const currentType = typeof config[key];

    switch (currentType) {
      case 'string':
        config[key] = stringValue;
        break;
      case 'number':
        config[key] = Number(stringValue);
        break;
      case 'boolean':
        config[key] = ['1', 'true', 'yes', 'on'].includes(stringValue.trim().toLowerCase());
        break;
      case 'object':
        if (Array.isArray(config[key])) {
          config[key] = stringValue.split(',').map(s => s.trim()) as ConfigEntry;
        }
        break;
    }
  }

  /** Environment variables are loaded into configuration, overriding existing settings. */
  function loadEnv(serverConfig: ServerConfig, clientConfig: ClientConfig): { server: ServerConfig; client: ClientConfig } {
    const resultServer = { ...serverConfig };
    const resultClient = { ...clientConfig };

    for (const key in ENV_NAMES) {
      const tag = ENV_NAMES[key];
      const val = process.env[tag];

      if (val == undefined) {
        continue;
      }

      if (SERVER_KEYS.has(key)) {
        applyConfigValue(resultServer, key, val);
      } else if (CLIENT_KEYS.has(key)) {
        applyConfigValue(resultClient, key, val);
      }
    }

    return { server: resultServer, client: resultClient };
  }

  /** Load configuration settings from YAML file */
  function loadYml(serverConfig: ServerConfig, clientConfig: ClientConfig, configPath: string): { server: ServerConfig; client: ClientConfig } {
    let loaded;
    try {
      const raw = fs.readFileSync(configPath, 'utf-8')
      loaded = yaml.load(raw) as Record<string, any>;
    } catch (err) {
      log.warn(`Could not load configuration from ${configPath}:`, err);
      return { server: serverConfig, client: clientConfig };
    }

    const resultServer = { ...serverConfig };
    const resultClient = { ...clientConfig };

    for (const envKey in loaded) {
      const key = Object.keys(ENV_NAMES).find(k => ENV_NAMES[k] === envKey);
      const val = loaded[envKey];

      if (val !== undefined && key) {
        const target = SERVER_KEYS.has(key) ? resultServer : CLIENT_KEYS.has(key) ? resultClient : null;
        if (!target) continue;
        // YAML is untyped, so a quoted "true"/"10" still has to land as the declared type.
        if (typeof val === 'string' && typeof target[key] !== 'string') {
          applyConfigValue(target, key, val);
        } else {
          target[key] = val;
        }
      }
    }

    return { server: resultServer, client: resultClient };
  }

  /** Create default settings.yaml content with descriptions */
  function getDefaultSettingsYaml(): string {
    let yamlContent = '';
    for (const key in DEFAULTS) {
      const name = ENV_NAMES[key];
      // configDir has no YAML form; it is where this very file lives.
      if (!name) continue;
      const desc = DESCRIPTIONS[key] ?? '';
      const value = DEFAULTS[key];
      yamlContent += `# ${desc}\n${name}: ${JSON.stringify(value)}\n\n`;
    }
    return yamlContent;
  }

  /** Ensure a configuration file exists by creating it if necessary. */
  function createIfNotExists(configPath: string): void {
    if (fs.existsSync(configPath)) {
      log.debug(`Configuration file found at ${configPath}.`);
      return;
    }

    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, getDefaultSettingsYaml(), 'utf-8');
      log.debug(`Created default configuration file at ${configPath}`);
      return;
    } catch (err) {
      log.warn(`Could not create default settings file at ${configPath} (mount may be read-only):`, err);
      return;
    }
  }

  /** Resolve the directory holding settings.yaml and tokens.txt. */
  function resolveConfigDir(): string {
    const configured = process.env.CONFIG_PATH;
    if (!configured) return DEFAULT_MOUNT;

    // CONFIG_PATH used to name the YAML file itself; accept that form so existing setups keep working.
    if (/\.ya?ml$/i.test(configured)) {
      const dir = path.dirname(configured);
      log.warn(`CONFIG_PATH should be a directory; using ${dir} instead of the file ${configured}.`);
      return dir;
    }

    return configured;
  }

  /** Load and merge settings.yaml with built-in defaults. */
  export function load(): Config {
    // Applied before anything else so the config loading itself already honours the requested verbosity.
    setLogLevel(process.env[ENV_NAMES.logLevel]);

    const configDir = resolveConfigDir();
    const configPath = settingsFilePath(configDir);
    createIfNotExists(configPath);
    const loaded = loadYml({ ...DEFAULT_SERVER_CONFIG }, { ...DEFAULT_CLIENT_CONFIG }, configPath);
    const envOverridden = loadEnv(loaded.server, loaded.client);
    const server = { ...envOverridden.server, configDir };
    if (!isLogLevel(server.logLevel)) {
      log.warn(`Unknown ${ENV_NAMES.logLevel} "${server.logLevel}", falling back to "${DEFAULT_LOG_LEVEL}". Valid levels: ${LOG_LEVELS.join(', ')}`);
      server.logLevel = DEFAULT_LOG_LEVEL;
    }
    server.logLevel = setLogLevel(String(server.logLevel));
    return { server, client: envOverridden.client };
  }

}