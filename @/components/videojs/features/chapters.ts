/** A named time span in seconds. */
export interface PlayerChapter {
    name: string;
    start: number;
    end: number;
}

/** Dispatched (bubbling) on the media element whenever its chapters are replaced. */
export const CHAPTERS_CHANGE_EVENT = 'chapterschange';

const tracks = new WeakMap<HTMLMediaElement, TextTrack>();
const chaptersByMedia = new WeakMap<HTMLMediaElement, readonly PlayerChapter[]>();

/**
 * Exposes `chapters` to the player as a native `kind="chapters"` text track, which the
 * time slider already renders as segments and names in its chapter title elements.
 */
export function setMediaChapters(media: HTMLMediaElement, chapters: readonly PlayerChapter[]): void {
    chaptersByMedia.set(media, chapters);
    // A src-less <track> element fails to load and exposes no cues, so use a script track;
    // those cannot be removed, hence one is reused per media element.
    let track = tracks.get(media);
    if (!track) {
        track = media.addTextTrack('chapters', 'Chapters');
        tracks.set(media, track);
    }
    track.mode = 'hidden';
    for (const cue of Array.from(track.cues ?? [])) track.removeCue(cue);
    for (const chapter of chapters) track.addCue(new VTTCue(chapter.start, chapter.end, chapter.name));
    // The player re-reads cues on the track list's `change` event.
    track.mode = 'disabled';
    track.mode = 'hidden';
    media.dispatchEvent(new Event(CHAPTERS_CHANGE_EVENT, { bubbles: true }));
}

export function getMediaChapters(media: HTMLMediaElement | null | undefined): readonly PlayerChapter[] {
    return (media && chaptersByMedia.get(media)) || [];
}

/** Nearest chapter start within `thresholdSeconds` of `time`, otherwise `time` unchanged. */
export function snapToChapter(time: number, chapters: readonly PlayerChapter[], thresholdSeconds: number): number {
    let best = time;
    let bestDistance = thresholdSeconds;
    for (const chapter of chapters) {
        const distance = Math.abs(chapter.start - time);
        if (distance <= bestDistance) {
            best = chapter.start;
            bestDistance = distance;
        }
    }
    return best;
}
