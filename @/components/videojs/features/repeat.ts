/**
 * Repeat mode exposed to the player UI.
 *
 * Like skipping, repeating spans more than one media element: `one` maps onto
 * the native `media.loop` of whichever player is active, while `queue` is a
 * playlist concern the player knows nothing about. The mode therefore lives
 * here, and both `<media-loop-button>` and the app subscribe to it.
 */
export type RepeatMode = 'off' | 'queue' | 'one';

/** Cycle order the button walks on each press. */
export const REPEAT_MODES: readonly RepeatMode[] = ['off', 'queue', 'one'];

export function nextRepeatMode(mode: RepeatMode): RepeatMode {
    const index = REPEAT_MODES.indexOf(mode);
    return REPEAT_MODES[(index + 1) % REPEAT_MODES.length];
}

let mode: RepeatMode = 'off';
const listeners = new Set<() => void>();

export function getRepeatMode(): RepeatMode {
    return mode;
}

export function setRepeatMode(next: RepeatMode): void {
    if (next === mode) return;
    mode = next;
    for (const listener of listeners) listener();
}

/** Advances to the next mode and returns it. */
export function cycleRepeatMode(): RepeatMode {
    setRepeatMode(nextRepeatMode(mode));
    return mode;
}

export function subscribeRepeat(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
