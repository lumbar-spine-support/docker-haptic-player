import { clamp01 } from './backend';

/** A JSON object stored in localStorage; malformed values are dropped. */
export function readJsonRecord(key: string): Record<string, unknown> {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        window.localStorage.removeItem(key);
        return {};
    }
}

export function writeJsonRecord(key: string, map: ReadonlyMap<string, unknown>): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(map)));
}

/** Feature → channel assignments and per-device strengths of one backend, persisted in localStorage. */
export class FeatureSettings {
    /** Feature id → channel key. */
    private readonly assignments = new Map<string, string>();
    /** Device name → strength multiplier 0–1. */
    private readonly strengths = new Map<string, number>();

    constructor(private readonly assignmentsKey: string, private readonly strengthsKey: string) {
        for (const [id, key] of Object.entries(readJsonRecord(assignmentsKey))) {
            if (typeof key === 'string') this.assignments.set(id, key);
        }
        for (const [name, value] of Object.entries(readJsonRecord(strengthsKey))) {
            if (typeof value === 'number') this.strengths.set(name, clamp01(value));
        }
    }

    getChannel(featureId: string): string | null {
        return this.assignments.get(featureId) ?? null;
    }

    /** Returns false when the assignment was already in place. */
    setChannel(featureId: string, channelKey: string | null): boolean {
        if (this.getChannel(featureId) === channelKey) return false;
        if (channelKey === null) this.assignments.delete(featureId);
        else this.assignments.set(featureId, channelKey);
        writeJsonRecord(this.assignmentsKey, this.assignments);
        return true;
    }

    get assignmentSnapshot(): ReadonlyMap<string, string> {
        return new Map(this.assignments);
    }

    /** Defaults to full strength. */
    getStrength(deviceName: string): number {
        return this.strengths.get(deviceName) ?? 1;
    }

    setStrength(deviceName: string, strength: number): void {
        this.strengths.set(deviceName, clamp01(strength));
        writeJsonRecord(this.strengthsKey, this.strengths);
    }
}
