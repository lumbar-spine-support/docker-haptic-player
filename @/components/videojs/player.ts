import { createPlayer } from '@videojs/html';
import { videoFeatures } from '@videojs/core/dom';
import { loopFeature } from './features/loop';

const { PlayerElement } = createPlayer({ features: [...videoFeatures, loopFeature] });

/** `<video-player>` with the stock video features plus our loop feature. */
export class AppPlayerElement extends PlayerElement {
    static readonly tagName = 'video-player';
}

export type AppPlayerStore = AppPlayerElement['store'];

customElements.define(AppPlayerElement.tagName, AppPlayerElement);
