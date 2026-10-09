import type { QueueSource } from '../../../shared/types';

/** A shuffled copy (Fisher–Yates). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/** One slot in the queue. The same track can be queued more than once, so entries carry their own id. */
export interface QueueEntry {
    readonly uid: number;
    readonly trackId: string;
}

/**
 * Ordered list of tracks the active player walks through.
 * Pure bookkeeping: it never touches a player.
 *
 * Entries before the current one are history, entries after it are "up next";
 * only the upcoming part can be reordered or removed. `source` names the
 * album/playlist the queue was started from and `edited` tells whether the
 * order still matches it (or the playlist it was last saved as).
 */
export class PlaybackQueue {
    private items: QueueEntry[] = [];
    private index = -1;
    private nextUid = 1;
    private readonly listeners = new Set<() => void>();
    source: QueueSource = { type: 'single' };
    edited = false;
    autoplay = true;

    /** Replaces the whole queue, starting at `startIndex`. */
    replace(trackIds: readonly string[], startIndex: number, source: QueueSource): void {
        this.items = trackIds.map((trackId) => this.entry(trackId));
        this.index = this.items.length ? Math.max(0, Math.min(startIndex, this.items.length - 1)) : -1;
        this.source = source;
        this.edited = false;
        this.emit();
    }

    /** Fires whenever order, position or source change. */
    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get entries(): readonly QueueEntry[] { return this.items; }
    get currentIndex(): number { return this.index; }
    get current(): QueueEntry | null { return this.items[this.index] ?? null; }
    get currentId(): string | null { return this.current?.trackId ?? null; }
    get hasPrev(): boolean { return this.index > 0; }
    get hasNext(): boolean { return this.index < this.items.length - 1; }
    get trackIds(): string[] { return this.items.map((item) => item.trackId); }

    /** Entries after the current one, in play order; everything while nothing is current yet. */
    get upcoming(): readonly QueueEntry[] {
        return this.items.slice(this.index + 1);
    }

    /** Whether `trackId` is still to come (the current entry does not count). */
    isUpcoming(trackId: string): boolean {
        return this.upcoming.some((item) => item.trackId === trackId);
    }

    step(direction: -1 | 1): string | null {
        const next = this.index + direction;
        if (next < 0 || next >= this.items.length) return null;
        this.index = next;
        this.emit();
        return this.items[next].trackId;
    }

    /** Re-points at the first track, for repeat-queue. */
    restart(): string | null {
        if (!this.items.length) return null;
        this.index = 0;
        this.emit();
        return this.items[0].trackId;
    }

    /** Makes any entry (history or upcoming) current; skipped entries become history. */
    jumpTo(uid: number): string | null {
        const at = this.items.findIndex((item) => item.uid === uid);
        if (at < 0) return null;
        this.index = at;
        this.emit();
        return this.items[at].trackId;
    }

    /** Puts tracks right after the current entry. */
    insertNext(trackIds: readonly string[]): void {
        if (!trackIds.length) return;
        this.items.splice(this.index + 1, 0, ...trackIds.map((trackId) => this.entry(trackId)));
        this.changed();
    }

    /**
     * Puts tracks at the very end. Nothing becomes current: before anything played
     * they wait as "up next" until a skip or a play starts them.
     */
    append(trackIds: readonly string[]): void {
        if (!trackIds.length) return;
        this.items.push(...trackIds.map((trackId) => this.entry(trackId)));
        this.changed();
    }

    /**
     * "Play this now" for a single track: the next upcoming entry of that track
     * becomes current, otherwise the track is inserted after the current entry.
     * The rest of the queue is kept either way.
     */
    playNow(trackId: string): void {
        const upcoming = this.upcoming.find((item) => item.trackId === trackId);
        if (upcoming) {
            this.jumpTo(upcoming.uid);
            return;
        }
        const entry = this.entry(trackId);
        this.items.splice(this.index + 1, 0, entry);
        this.index += 1;
        this.changed();
    }

    /** Reorders within `upcoming`; indices are relative to that list. */
    moveUpcoming(from: number, to: number): void {
        const count = this.upcoming.length;
        if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
        const base = this.index + 1;
        const [item] = this.items.splice(base + from, 1);
        this.items.splice(base + to, 0, item);
        this.changed();
    }

    /** Drops an upcoming entry; history and the current entry stay. */
    remove(uid: number): void {
        const at = this.items.findIndex((item) => item.uid === uid);
        if (at <= this.index) return;
        this.items.splice(at, 1);
        this.changed();
    }

    /** Shuffles what is left to play; history and the current entry keep their place. */
    shuffleUpcoming(random: () => number = Math.random): void {
        const base = this.index + 1;
        if (this.items.length - base < 2) return;
        this.items.splice(base, Infinity, ...shuffled(this.items.slice(base), random));
        this.changed();
    }

    /** Drops everything after the current entry. */
    clearUpcoming(): void {
        if (!this.upcoming.length) return;
        this.items.splice(this.index + 1);
        this.changed();
    }

    /** The queue was stored as this playlist, so it now matches it again. */
    markSaved(source: QueueSource): void {
        this.source = source;
        this.edited = false;
        this.emit();
    }

    private entry(trackId: string): QueueEntry {
        return { uid: this.nextUid++, trackId };
    }

    private changed(): void {
        this.edited = true;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}
