import type { QueueSource } from '../../../shared/types';

/**
 * Ordered list of tracks the active player walks through.
 * Pure bookkeeping: it never touches a player.
 */
export class PlaybackQueue {
    private trackIds: string[] = [];
    private index = -1;
    source: QueueSource = { type: 'single' };
    autoplay = true;
    private readonly listeners = new Set<() => void>();

    load(trackIds: string[], startId: string, source: QueueSource): void {
        this.trackIds = [...trackIds];
        this.index = this.trackIds.indexOf(startId);
        this.source = source;
        this.emit();
    }

    /** Fires whenever order or position changes. */
    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }

    /** Tracks after the current one, in play order. */
    get upcoming(): string[] {
        return this.index < 0 ? [] : this.trackIds.slice(this.index + 1);
    }

    get size(): number { return this.trackIds.length; }

    append(id: string): void {
        this.trackIds.push(id);
        if (this.index < 0) this.index = 0;
        this.emit();
    }

    removeUpcoming(i: number): void {
        if (i < 0 || i >= this.upcoming.length) return;
        this.trackIds.splice(this.index + 1 + i, 1);
        this.emit();
    }

    /** Drops everything but the current track. */
    clear(): void {
        const current = this.currentId;
        this.trackIds = current ? [current] : [];
        this.index = current ? 0 : -1;
        this.emit();
    }

    /** Reorders within `upcoming`; indices are relative to that list. */
    moveUpcoming(from: number, to: number): void {
        const count = this.upcoming.length;
        if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
        const base = this.index + 1;
        const [id] = this.trackIds.splice(base + from, 1);
        this.trackIds.splice(base + to, 0, id);
        this.emit();
    }

    /** Skips ahead to `upcoming[i]`; skipped tracks become history. */
    jumpTo(i: number): string | null {
        if (i < 0 || i >= this.upcoming.length) return null;
        this.index += i + 1;
        this.emit();
        return this.trackIds[this.index];
    }

    get currentId(): string | null { return this.trackIds[this.index] ?? null; }
    get hasPrev(): boolean { return this.index > 0; }
    get hasNext(): boolean { return this.index >= 0 && this.index < this.trackIds.length - 1; }

    step(direction: -1 | 1): string | null {
        const next = this.index + direction;
        if (next < 0 || next >= this.trackIds.length) return null;
        this.index = next;
        this.emit();
        return this.trackIds[next];
    }

    /** Re-points at the first track, for repeat-queue. */
    restart(): string | null {
        if (!this.trackIds.length) return null;
        this.index = 0;
        this.emit();
        return this.trackIds[0];
    }
}