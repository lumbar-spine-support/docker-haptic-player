import { UIElement, PlayerController, playerContext } from '@videojs/html';
import { selectLoop } from '../features/loop';
import './loop-button.css';

/**  Custom loop button
 * 
 * https://www.w3schools.com/TAgs/av_prop_loop.asp
 * 
 * https://videojs.org/docs/framework/html/how-to/build-your-own-component
 */
class LoopButtonElement extends UIElement {
    #loop = new PlayerController(this, playerContext, selectLoop);

    connectedCallback() {
        super.connectedCallback();
        this.setAttribute('role', 'button');
        this.setAttribute('tabindex', '0');
        this.addEventListener('click', this.#toggleLoop);
    }

    disconnectedCallback() {
        this.removeEventListener('click', this.#toggleLoop);
        super.disconnectedCallback();
    }

    protected update(): void {
        const looping = Boolean(this.#loop.value?.loop);
        this.setAttribute('aria-pressed', String(looping));
        // `data-active` is the attribute the skin stylesheets key their "on" state off.
        this.toggleAttribute('data-active', looping);
    }

    readonly #toggleLoop = () => {
        this.#loop.value?.toggleLoop();
    };
}

customElements.define('media-loop-button', LoopButtonElement);    
