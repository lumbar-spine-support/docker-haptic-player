import { UIElement } from '@videojs/html';
import { applyElementProps, createButton } from '@videojs/core/dom';
import { canSkip, getSkipTarget, stepFor, subscribeSkip, type SkipDirection, type SkipTarget } from '../features/skip';
import './skip-button.css';

export type { SkipDirection };

/**
 * Queue skip button — `direction="forward"` or `direction="backward"`.
 *
 * Mirrors the footer bar's prev/next controls: it steps the shared
 * `PlaybackQueue` and hides itself whenever that direction has no track.
 *
 * https://videojs.org/docs/framework/html/how-to/build-your-own-component
 */
export class SkipButtonElement extends UIElement {
    static readonly tagName = 'media-skip-button';

    static override properties = {
        direction: { type: String, reflect: true },
    };

    direction: SkipDirection = 'forward';

    #disconnect: AbortController | null = null;
    #unsubscribe: (() => void) | null = null;

    private get step(): -1 | 1 {
        return stepFor(this.direction);
    }

    private get enabled(): boolean {
        return canSkip(getSkipTarget(), this.step);
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#disconnect = new AbortController();
        // `createButton` gives the element the same role/tabindex/keyboard
        // activation contract the built-in media buttons use.
        applyElementProps(
            this,
            createButton({
                onActivate: () => this.#activate(),
                isDisabled: () => !this.enabled,
            }),
            { signal: this.#disconnect.signal },
        );
        this.#unsubscribe = subscribeSkip(() => this.requestUpdate());
    }

    override disconnectedCallback(): void {
        this.#disconnect?.abort();
        this.#disconnect = null;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        super.disconnectedCallback();
    }

    protected override update(changed: Map<string, unknown>): void {
        super.update(changed);
        const enabled = this.enabled;
        this.setAttribute('aria-label', this.step === -1 ? 'Previous' : 'Next');
        this.setAttribute('aria-disabled', String(!enabled));
        // `data-hidden` is what the stylesheet collapses, so the control bar
        // reflows instead of leaving a dead gap when the queue has no neighbour.
        this.toggleAttribute('data-hidden', !enabled);
    }

    #activate(): void {
        if (!this.enabled) return;
        const target = getSkipTarget() as SkipTarget;
        void Promise.resolve(target.step(this.step)).catch((error: unknown) => {
            console.error(`[${this.localName}]`, error);
        });
    }
}

customElements.define(SkipButtonElement.tagName, SkipButtonElement);

declare global {
    interface HTMLElementTagNameMap {
        [SkipButtonElement.tagName]: SkipButtonElement;
    }
}
