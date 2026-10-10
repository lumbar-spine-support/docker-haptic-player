/**
 * The playback queue exposed to the player UI.
 *
 * Like skipping, the queue is an app concern shared by both player slots, not
 * a media one. The app publishes one target here; the queue panel of every
 * `<video-player>` subscribes to it.
 */
export interface QueueItem {
    /** Id of the queue entry; the same track can be queued twice. */
    readonly uid: number;
    readonly trackId: string;
    readonly title: string;
    readonly subtitle: string;
}

export interface QueueState {
    readonly items: readonly QueueItem[];
    /** Index of the playing entry in `items`; -1 while nothing from the queue played yet. */
    readonly currentIndex: number;
    /** Name of the album or playlist the queue was started from (or last saved as), if any. */
    readonly sourceName: string | null;
    /** The queue came from (or was saved as) a playlist, so "Save" can write back to it. */
    readonly fromPlaylist: boolean;
    /** The order no longer matches that album or playlist. */
    readonly edited: boolean;
}

/** `overwrite` writes back to the playlist the queue came from; `new` creates one named `name`. */
export type QueueSave = { mode: 'overwrite' } | { mode: 'new'; name: string };

export interface QueueTarget {
    getState(): QueueState;
    jumpTo(uid: number): void | Promise<void>;
    /** Reorders the upcoming part; indices are relative to it. */
    moveUpcoming(from: number, to: number): void;
    remove(uid: number): void;
    shuffle(): void;
    clear(): void;
    /** Stores the whole queue as a Jellyfin playlist; resolves to a confirmation, rejects with a readable reason. */
    save(request: QueueSave): Promise<string>;
}

let target: QueueTarget | null = null;
const listeners = new Set<() => void>();

export function getQueueTarget(): QueueTarget | null {
    return target;
}

/** Publishes the object the queue UI drives; pass `null` to detach. */
export function setQueueTarget(next: QueueTarget | null): void {
    if (target === next) return;
    target = next;
    notifyQueueChanged();
}

/** Tells subscribed elements that the queue or the playing track may have changed. */
export function notifyQueueChanged(): void {
    for (const listener of listeners) listener();
}

export function subscribeQueue(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The entries after the playing one. */
export function upcomingOf(state: QueueState): readonly QueueItem[] {
    return state.items.slice(state.currentIndex + 1);
}
