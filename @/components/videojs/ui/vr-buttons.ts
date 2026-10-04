import { UIElement } from '@videojs/html';
import { applyElementProps, createButton } from '@videojs/core/dom';
import { selectVr } from '../features/vr';
import type { AppPlayerElement } from '../player';
import './vr-buttons.css';

type VrSlice = NonNullable<ReturnType<typeof selectVr>>;

/** Shared wiring: finds the player's VR state and re-renders on store changes. */
abstract class VrButtonElement extends UIElement {
    #disconnect: AbortController | null = null;
    #player: AppPlayerElement | null = null;

    protected get vr(): VrSlice | undefined {
        return this.#player ? selectVr(this.#player.store.state) : undefined;
    }

    protected abstract activate(vr: VrSlice): void;
    protected abstract render(vr: VrSlice | undefined): void;

    override connectedCallback(): void {
        super.connectedCallback();
        this.#disconnect = new AbortController();
        const { signal } = this.#disconnect;
        this.#player = this.closest<AppPlayerElement>('video-player');
        applyElementProps(this, createButton({
            onActivate: () => { const vr = this.vr; if (vr) this.activate(vr); },
            isDisabled: () => false,
        }), { signal });
        this.#player?.store.subscribe(() => this.requestUpdate(), { signal });
    }

    override disconnectedCallback(): void {
        this.#disconnect?.abort();
        this.#disconnect = null;
        this.#player = null;
        super.disconnectedCallback();
    }

    protected override update(changed: Map<string, unknown>): void {
        super.update(changed);
        this.render(this.vr);
    }
}

/** Toggles the inline panorama and the raw side-by-side/top-bottom frame. */
class VrViewButtonElement extends VrButtonElement {
    static readonly tagName = 'media-vr-view-button';

    protected activate(vr: VrSlice): void {
        vr.setVrMode(vr.vrMode === 'inline' ? 'flat' : 'inline');
    }

    protected render(vr: VrSlice | undefined): void {
        const on = vr?.vrMode === 'inline';
        this.toggleAttribute('data-hidden', !vr?.vrFormat);
        this.toggleAttribute('data-active', on);
        this.setAttribute('aria-pressed', String(on));
        this.setAttribute('aria-label', on ? 'Show flat frame' : 'Show VR view');
        this.querySelector('media-icon')?.setAttribute('name', on ? 'vr-on' : 'vr-off');
    }
}

/** Adds the device orientation to the panorama view (mobile, HTTPS only). */
class VrGyroButtonElement extends VrButtonElement {
    static readonly tagName = 'media-vr-gyro-button';

    protected activate(vr: VrSlice): void {
        void vr.toggleVrGyro();
    }

    protected render(vr: VrSlice | undefined): void {
        const on = Boolean(vr?.vrGyro);
        this.toggleAttribute('data-hidden', !vr?.vrFormat || !vr.vrGyroAvailable || vr.vrMode !== 'inline');
        this.toggleAttribute('data-active', on);
        this.setAttribute('aria-pressed', String(on));
        this.setAttribute('aria-label', on ? 'Disable motion control' : 'Enable motion control');
    }
}

customElements.define(VrViewButtonElement.tagName, VrViewButtonElement);
customElements.define(VrGyroButtonElement.tagName, VrGyroButtonElement);

declare global {
    interface HTMLElementTagNameMap {
        'media-vr-view-button': VrViewButtonElement;
        'media-vr-gyro-button': VrGyroButtonElement;
    }
}
