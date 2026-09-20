import { UIElement } from '@videojs/html';
import { applyElementProps, createButton } from '@videojs/core/dom';
import { cycleRepeatMode, getRepeatMode, subscribeRepeat, type RepeatMode } from '../features/repeat';
import './loop-button.css';

const LABELS: Record<RepeatMode, string> = {
    off: 'Repeat off',
    queue: 'Repeat queue',
    one: 'Repeat current',
};

/**  Custom loop button
 *
 * Cycles repeat off → queue → current; the app turns the mode into native
 * `media.loop` or a queue wrap-around.
 *
 * https://videojs.org/docs/framework/html/how-to/build-your-own-component
 */
class LoopButtonElement extends UIElement {
    static readonly tagName = 'media-loop-button';

    #disconnect: AbortController | null = null;
    #unsubscribe: (() => void) | null = null;

    override connectedCallback(): void {
        super.connectedCallback();
        this.#disconnect = new AbortController();
        // `createButton` gives the element the same role/tabindex/keyboard
        // activation contract the built-in media buttons use.
        applyElementProps(this, createButton({ onActivate: () => { cycleRepeatMode(); }, isDisabled: () => false }), {
            signal: this.#disconnect.signal,
        });
        this.#unsubscribe = subscribeRepeat(() => this.requestUpdate());
    }

    override disconnectedCallback(): void {
        this.#disconnect?.abort();
        this.#disconnect = null;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        super.disconnectedCallback();
    }

    protected override update(): void {
        const mode = getRepeatMode();
        this.setAttribute('data-mode', mode);
        this.setAttribute('aria-label', LABELS[mode]);
        this.setAttribute('aria-pressed', String(mode !== 'off'));
        // `data-active` is the attribute the skin stylesheets key their "on" state off.
        this.toggleAttribute('data-active', mode !== 'off');
        this.querySelector('media-icon')?.setAttribute('name', mode === 'one' ? 'repeat-one' : 'loop');
    }
}

customElements.define(LoopButtonElement.tagName, LoopButtonElement);

declare global {
    interface HTMLElementTagNameMap {
        'media-loop-button': LoopButtonElement;
    }
}

