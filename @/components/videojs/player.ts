import { createPlayer } from '@videojs/html';
import { videoFeatures } from '@videojs/core/dom';
import { loopFeature } from './features/loop';
import { vrFeature } from './features/vr';

const { PlayerElement } = createPlayer({ features: [...videoFeatures, loopFeature, vrFeature] });

/** `<video-player>` with the stock video features plus our loop and VR features. */
export class AppPlayerElement extends PlayerElement {
    static readonly tagName = 'video-player';
}

export type AppPlayerStore = AppPlayerElement['store'];

customElements.define(AppPlayerElement.tagName, AppPlayerElement);
