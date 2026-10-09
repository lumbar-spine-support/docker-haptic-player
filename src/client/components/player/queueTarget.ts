import type { Library } from '../library';
import type { PlaybackController } from './controller';
import type { PlaybackQueue } from './queue';
import { notifyQueueChanged, setQueueTarget, type QueueState, type QueueTarget } from '@/components/videojs/features/queue';

/**
 * Publishes the queue to the player UI (queue panel, add-to-queue button):
 * reads come from the queue and the library, every change goes through the
 * controller.
 */
export function publishQueue(queue: PlaybackQueue, controller: PlaybackController, library: Library): QueueTarget {
    const target: QueueTarget = {
        getState(): QueueState {
            const source = queue.source;
            const sourceName = source.type === 'playlist' ? library.getPlaylist(source.id)?.name
                : source.type === 'album' ? library.getAlbum(source.id)?.title
                    : undefined;
            return {
                items: queue.entries.map((entry) => {
                    const track = library.getTrack(entry.trackId);
                    return {
                        uid: entry.uid,
                        trackId: entry.trackId,
                        title: track?.title ?? 'Unknown',
                        subtitle: track?.artist || track?.filename || '',
                    };
                }),
                currentIndex: queue.currentIndex,
                sourceName: sourceName ?? null,
            };
        },
        placeOf(trackId) {
            if (queue.currentId === trackId) return 'current';
            return queue.isUpcoming(trackId) ? 'upcoming' : null;
        },
        enqueue: (trackId) => controller.enqueue([trackId]),
        jumpTo: (uid) => controller.jumpTo(uid),
        moveUpcoming: (from, to) => controller.moveUpcoming(from, to),
        remove: (uid) => controller.removeFromQueue(uid),
        shuffle: () => controller.shuffleUpcoming(),
        clear: () => controller.clearUpcoming(),
    };
    queue.onChange(notifyQueueChanged);
    setQueueTarget(target);
    return target;
}
