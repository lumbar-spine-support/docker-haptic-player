import { UIElement } from '@videojs/html';
import { applyElementProps, createButton } from '@videojs/core/dom';
import { getFavoriteTarget, subscribeFavorite, TRACK_ID_ATTRIBUTE } from '../features/favorite';
import './favorite-button.css';

/**
 * Jellyfin favorite button.
 *
 * Shows and toggles the favorite flag of the track in its own `<video-player>`
 * (the two player slots can hold different tracks). Hidden while the player
 * holds nothing the app knows.
 *
 * https://videojs.org/docs/framework/html/how-to/build-your-own-component
 */
class FavoriteButtonElement extends UIElement {
    static readonly tagName = 'media-favorite-button';

    #disconnect: AbortController | null = null;
    #unsubscribe: (() => void) | null = null;
    #observer: MutationObserver | null = null;
    #player: HTMLElement | null = null;

    private get trackId(): string | null {
        return this.#player?.getAttribute(TRACK_ID_ATTRIBUTE) ?? null;
    }

    private get favorite(): boolean | null {
        const id = this.trackId;
        return id ? getFavoriteTarget()?.isFavorite(id) ?? null : null;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#disconnect = new AbortController();
        this.#player = this.closest<HTMLElement>('video-player');
        // `createButton` gives the element the same role/tabindex/keyboard
        // activation contract the built-in media buttons use.
        applyElementProps(this, createButton({
            onActivate: () => this.#activate(),
            isDisabled: () => this.favorite === null,
        }), { signal: this.#disconnect.signal });
        this.#unsubscribe = subscribeFavorite(() => this.requestUpdate());
        if (this.#player) {
            this.#observer = new MutationObserver(() => this.requestUpdate());
            this.#observer.observe(this.#player, { attributes: true, attributeFilter: [TRACK_ID_ATTRIBUTE] });
        }
    }

    override disconnectedCallback(): void {
        this.#disconnect?.abort();
        this.#disconnect = null;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#observer?.disconnect();
        this.#observer = null;
        this.#player = null;
        super.disconnectedCallback();
    }

    protected override update(changed: Map<string, unknown>): void {
        super.update(changed);
        const favorite = this.favorite;
        this.toggleAttribute('data-hidden', favorite === null);
        this.setAttribute('aria-disabled', String(favorite === null));
        this.setAttribute('aria-pressed', String(favorite === true));
        this.setAttribute('aria-label', favorite ? 'Remove from favorites' : 'Add to favorites');
        // `data-active` is the attribute the skin stylesheets key their "on" state off.
        this.toggleAttribute('data-active', favorite === true);
        this.querySelector('media-icon')?.setAttribute('name', favorite ? 'favorite-on' : 'favorite-off');
    }

    #activate(): void {
        const id = this.trackId;
        const target = getFavoriteTarget();
        if (!id || !target || this.favorite === null) return;
        void Promise.resolve(target.toggle(id)).catch((error: unknown) => {
            console.error(`[${this.localName}]`, error);
        });
    }
}

customElements.define(FavoriteButtonElement.tagName, FavoriteButtonElement);

declare global {
    interface HTMLElementTagNameMap {
        'media-favorite-button': FavoriteButtonElement;
    }
}
