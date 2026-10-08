function replaceDefaultTrack(media: HTMLMediaElement, kind: 'chapters' | 'metadata', label: string, src: string | null): void {
    media.querySelector(`track[kind="${kind}"][label="${label}"]`)?.remove();
    if (!src) return;
    const track = document.createElement('track');
    track.kind = kind;
    track.label = label;
    // Non-default tracks stay disabled and never load their cues.
    track.default = true;
    track.src = src;
    media.append(track);
}

/** Chapters WebVTT; the time slider renders segments and the preview title from it natively. */
export function setMediaChapters(media: HTMLMediaElement, src: string | null): void {
    replaceDefaultTrack(media, 'chapters', 'chapters', src);
}

/** Storyboard WebVTT; Video.js picks it up as `thumbnailsTrack` for `<media-slider-thumbnail>`. */
export function setMediaStoryboard(media: HTMLMediaElement, src: string | null): void {
    replaceDefaultTrack(media, 'metadata', 'thumbnails', src);
}

/** Nearest chapter start within `thresholdSeconds` of `time`, otherwise `time` unchanged. */
export function snapToChapter(time: number, starts: readonly number[], thresholdSeconds: number): number {
    let best = time;
    let bestDistance = thresholdSeconds;
    for (const start of starts) {
        const distance = Math.abs(start - time);
        if (distance <= bestDistance) {
            best = start;
            bestDistance = distance;
        }
    }
    return best;
}
