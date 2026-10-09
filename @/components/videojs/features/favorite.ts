/**
 * Jellyfin favorites exposed to the player UI.
 *
 * Like skipping, a favorite is a *library* concern: the flag lives on the
 * app's in-memory track, not in a player store. The app publishes one target
 * here and every `<media-favorite-button>` asks it about the track its own
 * `<video-player>` holds (`data-track-id`).
 */
export interface FavoriteTarget {
    /** The favorite state of a track, or `null` when the id is unknown. */
    isFavorite(trackId: string): boolean | null;
    toggle(trackId: string): void | Promise<void>;
}

/** Attribute on `<video-player>` naming the library track it holds. */
export const TRACK_ID_ATTRIBUTE = 'data-track-id';

let target: FavoriteTarget | null = null;
const listeners = new Set<() => void>();

export function getFavoriteTarget(): FavoriteTarget | null {
    return target;
}

/** Publishes the object the favorite buttons drive; pass `null` to detach. */
export function setFavoriteTarget(next: FavoriteTarget | null): void {
    if (target === next) return;
    target = next;
    notifyFavoriteChanged();
}

/** Tells subscribed buttons that a favorite may have changed. */
export function notifyFavoriteChanged(): void {
    for (const listener of listeners) listener();
}

export function subscribeFavorite(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
