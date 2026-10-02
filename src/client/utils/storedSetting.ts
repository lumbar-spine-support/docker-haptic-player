type Stored = string | number | boolean;
type Widen<T> = T extends boolean ? boolean : T extends number ? number : string;

export interface StoredSetting<T extends Stored> {
    get(): T;
    set(value: T): void;
}

/** A localStorage value parsed to the fallback's type; the fallback applies when nothing valid is stored. */
export function storedSetting<T extends Stored>(key: string, fallback: T): StoredSetting<Widen<T>>;
export function storedSetting(key: string, fallback: Stored): StoredSetting<Stored> {
    return {
        get(): Stored {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            if (typeof fallback === 'boolean') return raw === 'true';
            if (typeof fallback === 'number') {
                const value = Number(raw);
                return Number.isFinite(value) ? value : fallback;
            }
            return raw;
        },
        set(value: Stored): void {
            localStorage.setItem(key, String(value));
        },
    };
}
