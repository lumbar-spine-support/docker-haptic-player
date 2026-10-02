import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createLogger, DEFAULT_LOG_LEVEL, isLogLevel, LOG_LEVELS, setLogLevel } from './utils/logger';
import { DEFAULT_INTERPOLATION_METHOD, INTERPOLATION_METHODS, isInterpolationMethod } from '../shared/interpolation';
import { CHAPTER_SOURCES } from '../shared/types';

export namespace Config {

  export const TAG = '[config]';

  const log = createLogger(TAG);

  export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
  export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'flac'];

  /** Dungeon Lab WebSocket route for relay enabling communication between App and Controller. */
  export const DGLAB_WS_PATH = '/ws/dglab';

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
    chapterSourcePriority: string[];
  }

  /** Stores the client-side configuration. Can be loaded from YAML or environment variables. */
  export interface ClientConfig {
    [key: string]: ConfigEntry;
    videoSeekInterval: number;
    blurContent: boolean;
    hapticFrequency: number;
    hapticDelay: number;
    hapticDelayLimit: number;
    dglabEnabled: boolean;
    funscriptInterpolationMethod: string;
    funscriptColorGradient: boolean;
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
    chapterSourcePriority: ['embedded', 'funscript'],
  };

  export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
    videoSeekInterval: 10,
    blurContent: false,
    hapticFrequency: 30,
    hapticDelay: 0,
    hapticDelayLimit: 500,
    dglabEnabled: false,
    funscriptInterpolationMethod: DEFAULT_INTERPOLATION_METHOD,
    funscriptColorGradient: false,
  };

  export const DEFAULTS = { ...DEFAULT_SERVER_CONFIG, ...DEFAULT_CLIENT_CONFIG };

  export const DESCRIPTIONS: Record<string, string> = {
    port: 'HTTP port of the web interface.',
    mediaDir: 'Directory that contains media files (inside container).',
    ignoreExt: 'File extensions to ignore (without leading dot)',
    password: 'Web interface access password. Leave empty to disable authentication',
    trustProxy: 'Number of reverse proxy hops to trust for X-Forwarded-* headers. 0 for direct LAN access, 1 behind nginx/Traefik',
    logLevel: `Verbosity of the console log: ${LOG_LEVELS.join(', ')}`,
    videoSeekInterval: 'Seek interval in seconds when double-tapping/clicking.',
    blurContent: 'Enable to blur images and videos. Can be toggled in web interface.',
    hapticFrequency: 'Intiface Haptic update frequency in Hz. Smaller values are usually more stable but less precise. Can be changed in web interface.',
    hapticDelay: 'Default haptic delay in milliseconds to sync video and haptics. Can be changed in web interface.',
    hapticDelayLimit: 'Maximum absolute haptic delay in milliseconds selectable in the web interface (range is -limit to +limit).',
    dglabEnabled: '(EXPERIMENTAL) Enable DG-Lab Coyote 3.0 component for e-stim toy control.',
    funscriptInterpolationMethod: `How positions between funscript points are computed for haptics and the timeline: ${INTERPOLATION_METHODS.join(', ')}. none holds each position until the next point; strokers follow pchip as linear`,
    funscriptColorGradient: 'Colour the timeline graph on a heat scale by movement speed (blue = slow, red = fast). Can be toggled in web interface.',
    funscriptSuffixSeparator: 'Single character that separates filename from funscript suffix',
    funscriptSuffixStroker: 'Suffix associated with stroker funscript',
    funscriptSuffixButtplug: 'Suffix associated with buttplug funscript',
    funscriptSuffixVibrator: 'Suffix associated with vibrator funscript',
    funscriptSuffixEstim: 'Suffix associated with estim funscript',
    funscriptSuffixMachine: 'Suffix associated with machine funscript',
    chapterSourcePriority: `Chapter sources in order of precedence: ${CHAPTER_SOURCES.join(', ')}. The first source that provides chapters is used. Empty to disable chapters`,
  };

  export const ENV_NAMES: Record<string, string> = {
    port: 'PORT',
    mediaDir: 'MEDIA_DIR',
    ignoreExt: 'IGNORE_EXT',
    password: 'PASSWORD',
    trustProxy: 'TRUST_PROXY',
    logLevel: 'LOG_LEVEL',
    videoSeekInterval: 'VIDEO_SEEK_INTERVAL',
    blurContent: 'DEFAULT_BLUR_CONTENT',
    hapticFrequency: 'DEFAULT_HAPTIC_FREQUENCY',
    hapticDelay: 'DEFAULT_HAPTIC_DELAY',
    hapticDelayLimit: 'HAPTIC_DELAY_LIMIT',
    dglabEnabled: 'DGLAB_ENABLED',
    funscriptInterpolationMethod: 'FUNSCRIPT_INTERPOLATION_METHOD',
    funscriptColorGradient: 'FUNSCRIPT_COLOR_GRADIENT',
    funscriptSuffixSeparator: 'FUNSCRIPT_SUFFIX_SEPARATOR',
    funscriptSuffixStroker: 'FUNSCRIPT_SUFFIX_STROKER',
    funscriptSuffixButtplug: 'FUNSCRIPT_SUFFIX_BUTTPLUG',
    funscriptSuffixVibrator: 'FUNSCRIPT_SUFFIX_VIBRATOR',
    funscriptSuffixEstim: 'FUNSCRIPT_SUFFIX_ESTIM',
    funscriptSuffixMachine: 'FUNSCRIPT_SUFFIX_MACHINE',
    chapterSourcePriority: 'CHAPTER_SOURCE_PRIORITY',
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
        config[key] = ['true', '1', 'yes', 'on'].includes(stringValue.trim().toLowerCase());
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
        if (val === null && typeof target[key] === 'string') {
          target[key] = '';
        } else if (typeof val === 'string' && typeof target[key] !== 'string') {
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
    const env = loadEnv({ ...DEFAULT_SERVER_CONFIG }, { ...DEFAULT_CLIENT_CONFIG });
    const values: Record<string, ConfigEntry> = { ...env.server, ...env.client };
    let yamlContent = '';
    for (const key in DEFAULTS) {
      const name = ENV_NAMES[key];
      // configDir has no YAML form; it is where this very file lives.
      if (!name) continue;
      const desc = DESCRIPTIONS[key] ?? '';
      const value = values[key];
      yamlContent += `# ${desc}\n${name}: ${JSON.stringify(value)}\n\n`;
    }
    return yamlContent;
  }

  const DEPRECATED_MARKER = '# (DEPRECATED) This setting is not used anymore';

  /** Rewrite an existing settings.yaml so it lists all current settings with up-to-date descriptions, keeping user values and commenting out unknown keys. */
  export function updateSettingsFile(configPath: string): void {
    let raw: string;
    let loaded: Record<string, unknown>;
    try {
      raw = fs.readFileSync(configPath, 'utf-8');
      loaded = (yaml.load(raw) as Record<string, unknown> | null) ?? {};
      if (typeof loaded !== 'object' || Array.isArray(loaded)) return;
    } catch (err) {
      log.warn(`Could not read configuration from ${configPath} for update:`, err);
      return;
    }

    const knownNames = new Set(Object.values(ENV_NAMES));
    let content = '';
    for (const key in DEFAULTS) {
      const name = ENV_NAMES[key];
      if (!name) continue;
      const value = name in loaded ? loaded[name] : DEFAULTS[key];
      content += `# ${DESCRIPTIONS[key] ?? ''}\n${name}: ${JSON.stringify(value)}\n\n`;
    }

    // Carry over entries deprecated by earlier updates, since they are comments and invisible to the parser.
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].trim() === DEPRECATED_MARKER) {
        content += `${DEPRECATED_MARKER}\n${lines[i + 1]}\n\n`;
      }
    }

    for (const name in loaded) {
      if (knownNames.has(name)) continue;
      content += `${DEPRECATED_MARKER}\n# ${name}: ${JSON.stringify(loaded[name])}\n\n`;
    }

    if (content === raw) return;
    try {
      fs.writeFileSync(configPath, content, 'utf-8');
      log.info(`Updated configuration file at ${configPath}`);
    } catch (err) {
      log.warn(`Could not update settings file at ${configPath} (mount may be read-only):`, err);
    }
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

  /** Drop unknown and duplicate chapter sources, warning about each unknown one. */
  export function validateChapterSources(value: unknown): string[] {
    const list = Array.isArray(value) ? value : [];
    const result: string[] = [];
    for (const entry of list) {
      const name = String(entry).trim().toLowerCase();
      if (!name) continue;
      if (!(CHAPTER_SOURCES as readonly string[]).includes(name)) {
        log.warn(`Unknown chapter source "${entry}" in ${ENV_NAMES.chapterSourcePriority}. Valid sources: ${CHAPTER_SOURCES.join(', ')}`);
        continue;
      }
      if (!result.includes(name)) result.push(name);
    }
    return result;
  }

  /** Load and merge settings.yaml with built-in defaults. */
  export function load(): Config {
    // Applied before anything else so the config loading itself already honours the requested verbosity.
    setLogLevel(process.env[ENV_NAMES.logLevel]);

    const configDir = resolveConfigDir();
    const configPath = settingsFilePath(configDir);
    createIfNotExists(configPath);
    const loaded = loadYml({ ...DEFAULT_SERVER_CONFIG }, { ...DEFAULT_CLIENT_CONFIG }, configPath);
    if (fs.existsSync(configPath)) updateSettingsFile(configPath);
    const envOverridden = loadEnv(loaded.server, loaded.client);
    const server = { ...envOverridden.server, configDir };
    if (!isLogLevel(server.logLevel)) {
      log.warn(`Unknown ${ENV_NAMES.logLevel} "${server.logLevel}", falling back to "${DEFAULT_LOG_LEVEL}". Valid levels: ${LOG_LEVELS.join(', ')}`);
      server.logLevel = DEFAULT_LOG_LEVEL;
    }
    server.logLevel = setLogLevel(String(server.logLevel));
    server.chapterSourcePriority = validateChapterSources(server.chapterSourcePriority);
    const client = envOverridden.client;
    if (!isInterpolationMethod(client.funscriptInterpolationMethod)) {
      log.warn(`Unknown ${ENV_NAMES.funscriptInterpolationMethod} "${client.funscriptInterpolationMethod}", falling back to "${DEFAULT_INTERPOLATION_METHOD}". Valid methods: ${INTERPOLATION_METHODS.join(', ')}`);
      client.funscriptInterpolationMethod = DEFAULT_INTERPOLATION_METHOD;
    }
    return { server, client };
  }

}