import { definePlayerFeature } from '@videojs/core/dom';
import { createSelector } from '@videojs/html';
import { listen } from '@videojs/utils/dom';
import { vrFormatFromAttribute, type VrFormat } from '../../../../src/shared/vrFormat';
import { installDragGuard } from '../../../../src/client/components/vr/dragGuard';
import { InlineVrView } from '../../../../src/client/components/vr/inline';
import type { VrMode } from '../../../../src/client/components/vr/types';

const ATTR = 'data-vr-format';

interface VrState {
    vrFormat: VrFormat | null;
    vrMode: VrMode;
    vrGyroAvailable: boolean;
    vrGyro: boolean;
}

/** Per-player VR state; `<video-player>` carries `data-vr-format` for VR tracks (see `PlaybackSession`). */
class VrController {
    private format: VrFormat | null = null;
    private view: InlineVrView | null = null;
    private mode: VrMode = 'flat';

    constructor(
        private readonly player: Element,
        private readonly container: HTMLElement,
        private readonly video: HTMLVideoElement,
        private readonly set: (patch: Partial<VrState>) => void,
    ) { }

    /** New track (or new format): drop the previous view and start in the default mode. */
    reset(): void {
        this.view?.stop();
        this.format = vrFormatFromAttribute(this.player.getAttribute(ATTR));
        this.view = this.format ? new InlineVrView(this.container, this.video, this.format) : null;
        this.mode = 'flat';
        this.set({ vrFormat: this.format, vrMode: 'flat', vrGyro: false });
        if (this.format) void this.setMode('inline');
    }

    async setMode(mode: VrMode): Promise<void> {
        // Immersive mode arrives with the WebXR stage.
        if (mode === 'immersive' || mode === this.mode) return;
        if (mode === 'inline' && !this.view) return;
        this.mode = mode;
        if (mode === 'inline') {
            try {
                await this.view!.start();
            } catch (error) {
                console.error('[vr]', error);
                this.mode = 'flat';
            }
        } else {
            this.view?.stop();
        }
        this.set({ vrMode: this.mode });
    }

    async toggleGyro(): Promise<boolean> {
        if (!this.view || this.mode !== 'inline') return false;
        const enabled = await this.view.setGyro(!this.view.gyro);
        this.set({ vrGyro: enabled });
        return enabled;
    }

    resetView(): void {
        this.view?.resetView();
    }

    dispose(): void {
        this.view?.stop();
        this.view = null;
    }
}

const controllers = new WeakMap<object, VrController>();

export const vrFeature = definePlayerFeature({
    name: 'vr',
    state: ({ target, set }) => ({
        vrFormat: null as VrFormat | null,
        vrMode: 'flat' as VrMode,
        vrGyroAvailable: false,
        vrGyro: false,
        setVrMode(mode: VrMode) {
            void controllers.get(target().media)?.setMode(mode);
        },
        async toggleVrGyro() {
            const controller = controllers.get(target().media);
            if (!controller) {
                set({ vrGyro: false });
                return false;
            }
            return controller.toggleGyro();
        },
        resetVrView() {
            controllers.get(target().media)?.resetView();
        },
    }),
    attach({ target, signal, set }) {
        const { media } = target;
        if (!(media instanceof HTMLVideoElement)) return;
        const player = media.closest('video-player');
        const container = target.container ?? media.closest<HTMLElement>('media-container');
        if (!player || !container) return;

        set({
            vrGyroAvailable: 'DeviceOrientationEvent' in window
                && window.isSecureContext
                && window.matchMedia('(pointer: coarse)').matches,
        });

        const controller = new VrController(player, container, media, set);
        controllers.set(media, controller);
        installDragGuard(container, () => player.hasAttribute(ATTR), signal);

        let lastAttr = player.getAttribute(ATTR);
        const observer = new MutationObserver(() => {
            const attr = player.getAttribute(ATTR);
            if (attr === lastAttr) return;
            lastAttr = attr;
            controller.reset();
        });
        observer.observe(player, { attributes: true, attributeFilter: [ATTR] });
        // The user's mode choice only lasts for the current track.
        listen(media, 'loadstart', () => controller.reset(), { signal });
        controller.reset();

        signal.addEventListener('abort', () => {
            observer.disconnect();
            controller.dispose();
            controllers.delete(media);
        });
    },
});

export const selectVr = createSelector(vrFeature);
