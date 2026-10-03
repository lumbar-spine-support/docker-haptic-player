import type { PlaybackSession } from '../components/player';

/** Keep the screen on while media plays; Android Chrome freezes the tab once it turns off. Returns an on/off switch. */
export function keepScreenOnWhilePlaying(session: PlaybackSession): (enabled: boolean) => void {
    if (!('wakeLock' in navigator)) return () => undefined;
    let enabled = true;
    let lock: WakeLockSentinel | null = null;
    let pending = false;

    const update = (): void => {
        const wanted = enabled && !session.activeStore.state.paused && document.visibilityState === 'visible';
        if (wanted && !lock && !pending) {
            pending = true;
            navigator.wakeLock.request('screen')
                .then((sentinel) => {
                    lock = sentinel;
                    // The browser releases the lock itself when the page is hidden.
                    sentinel.addEventListener('release', () => { if (lock === sentinel) lock = null; });
                    update();
                })
                .catch(() => undefined)
                .finally(() => { pending = false; });
        } else if (!wanted && lock) {
            const sentinel = lock;
            lock = null;
            void sentinel.release();
        }
    };

    session.onChange(update);
    document.addEventListener('visibilitychange', update);
    return (value) => {
        enabled = value;
        update();
    };
}
