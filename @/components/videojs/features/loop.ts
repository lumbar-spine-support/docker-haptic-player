import { definePlayerFeature } from '@videojs/core/dom';
import { createSelector } from '@videojs/html';
import { listen } from '@videojs/utils/dom';

/**
 * Native `media.loop` exposed as a player feature.
 *
 * Must be passed to `createPlayer()` (see `../player.ts`) — a feature that is
 * only defined is never part of any store, and `selectLoop` would stay undefined.
 */
export const loopFeature = definePlayerFeature({
    name: 'loop',
    state: ({ target, set }) => ({
        loop: false,
        toggleLoop() {
            const { media } = target();
            if (!('loop' in media)) return false;
            const next = !media.loop;
            media.loop = next;
            set({ loop: next });
            return next;
        },
    }),
    attach({ target, signal, set }) {
        const { media } = target;
        if (!('loop' in media)) return;
        const sync = () => set({ loop: Boolean(media.loop) });
        sync();
        listen(media, 'loadedmetadata', sync, { signal });
    },
});

export const selectLoop = createSelector(loopFeature);
