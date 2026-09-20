/**
 * Queue navigation exposed to the player UI.
 *
 * Skipping is a *playlist* concern, not a media one, so it cannot be a player
 * feature the way `loop` is: the queue lives outside any single player element
 * and is shared by every skin instance on the page. Instead the app publishes a
 * single target here and `<media-skip-button>` subscribes to it.
 */
export interface SkipTarget {
    /** Whether a previous/next track exists in the current queue. */
    readonly canStep: { prev: boolean; next: boolean };
    step(direction: -1 | 1): void | Promise<void>;
}

export type SkipDirection = 'forward' | 'backward';

/** `direction` attribute value as the queue step it represents. */
export function stepFor(direction: string | null): -1 | 1 {
    return direction === 'backward' ? -1 : 1;
}

/** Whether `target` currently has a track in the given direction. */
export function canSkip(target: SkipTarget | null, step: -1 | 1): boolean {
    if (!target) return false;
    return step === -1 ? target.canStep.prev : target.canStep.next;
}

let target: SkipTarget | null = null;
const listeners = new Set<() => void>();

export function getSkipTarget(): SkipTarget | null {
    return target;
}

/** Publishes the object the skip buttons drive; pass `null` to detach. */
export function setSkipTarget(next: SkipTarget | null): void {
    if (target === next) return;
    target = next;
    notifySkipChanged();
}

/** Tells subscribed buttons that `canStep` may have changed. */
export function notifySkipChanged(): void {
    for (const listener of listeners) listener();
}

export function subscribeSkip(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
