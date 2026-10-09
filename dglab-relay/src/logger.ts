// Minimal level-filtered logger writing to the process stdio, i.e. the docker console.
// A module-level singleton because most modules log before any config object reaches them.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];

const SEVERITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

let currentLevel: LogLevel = DEFAULT_LOG_LEVEL;

export function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === 'string' && (LOG_LEVELS as string[]).includes(value.toLowerCase());
}

/** Unknown names keep the previous level so a typo cannot silence the log entirely. */
export function setLogLevel(level: string | undefined): LogLevel {
    if (isLogLevel(level)) currentLevel = level.toLowerCase() as LogLevel;
    return currentLevel;
}

export function getLogLevel(): LogLevel {
    return currentLevel;
}

export function isLevelEnabled(level: LogLevel): boolean {
    return SEVERITY[level] <= SEVERITY[currentLevel];
}

const SINKS: Record<LogLevel, (...args: unknown[]) => void> = {
    error: (...args) => console.error(...args),
    warn: (...args) => console.warn(...args),
    info: (...args) => console.log(...args),
    debug: (...args) => console.log(...args),
};

function emit(level: LogLevel, tag: string, args: unknown[]): void {
    if (!isLevelEnabled(level)) return;
    SINKS[level](`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${tag}`, ...args);
}

export interface Logger {
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    isDebug(): boolean;
}

export function createLogger(tag: string): Logger {
    return {
        error: (...args) => emit('error', tag, args),
        warn: (...args) => emit('warn', tag, args),
        info: (...args) => emit('info', tag, args),
        debug: (...args) => emit('debug', tag, args),
        isDebug: () => isLevelEnabled('debug'),
    };
}
