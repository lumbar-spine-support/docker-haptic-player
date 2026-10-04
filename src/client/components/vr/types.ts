import type { VrFormat } from '../../../shared/vrFormat';

export type VrMode = 'flat' | 'inline' | 'immersive';
export type VrEye = 'left' | 'right';

/** A way of presenting a VR video; the player feature switches modes only through this. */
export interface VrView {
    start(): Promise<void>;
    stop(): void;
}

export type { VrFormat };
