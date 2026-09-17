import type { QueueSource } from '../../../shared/types';

/**
 * Ordered list of tracks the active player walks through.
 * Pure bookkeeping: it never touches a player.
 */
export class PlaybackQueue {
    private trackIds: string[] = [];
    private index = -1;
    source: QueueSource = { type: 'single' };
    autoplay = true;

    load(trackIds: string[], startId: string, source: QueueSource): void {
        this.trackIds = trackIds;
        this.index = trackIds.indexOf(startId);
        this.source = source;
    }

    get currentId(): string | null { return this.trackIds[this.index] ?? null; }
    get hasPrev(): boolean { return this.index > 0; }
    get hasNext(): boolean { return this.index >= 0 && this.index < this.trackIds.length - 1; }

    step(direction: -1 | 1): string | null {
        const next = this.index + direction;
        if (next < 0 || next >= this.trackIds.length) return null;
        this.index = next;
        return this.trackIds[next];
    }
}