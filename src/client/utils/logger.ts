export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

/** localStorage key holding overrides, e.g. `dglab=debug,dglab:socket=warn,*=info`. */
export const LOG_STORAGE_KEY = 'happy-log';

const levels = new Map<string, LogLevel>([['*', 'info']]);

export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

/** Set the level for a namespace and its `ns:*` children; `'*'` sets the default. */
export function setLogLevel(namespace: string, level: LogLevel): void {
    levels.set(namespace, level);
}

function parseOverrides(): Map<string, LogLevel> {
    const result = new Map<string, LogLevel>();
    let raw: string | null | undefined;
    try {
        raw = globalThis.localStorage?.getItem(LOG_STORAGE_KEY);
    } catch {
        return result;
    }
    for (const entry of (raw ?? '').split(',')) {
        const [ns, lvl] = entry.split('=').map((s) => s.trim());
        if (ns && lvl && lvl in RANK) result.set(ns, lvl as LogLevel);
    }
    return result;
}

function lookup(table: Map<string, LogLevel>, namespace: string): LogLevel | undefined {
    for (let ns = namespace; ;) {
        const level = table.get(ns);
        if (level) return level;
        const cut = ns.lastIndexOf(':');
        if (cut < 0) return table.get('*');
        ns = ns.slice(0, cut);
    }
}

/** Resolve the effective level: localStorage overrides win over `setLogLevel`. */
export function getLogLevel(namespace: string): LogLevel {
    return lookup(parseOverrides(), namespace) ?? lookup(levels, namespace) ?? 'info';
}

export function createLogger(namespace: string): Logger {
    const tag = `[${namespace}]`;
    const emit = (level: Exclude<LogLevel, 'silent'>) => (...args: unknown[]) => {
        if (RANK[level] >= RANK[getLogLevel(namespace)]) console[level](tag, ...args);
    };
    return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
