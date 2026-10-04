/** A named time span in seconds. */
export interface PlayerChapter {
    name: string;
    start: number;
    end: number;
}

const vttTime = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(11, 23);

/** Replaces the media's default `kind="chapters"` track, which the time slider renders natively. */
export function setMediaChapters(media: HTMLMediaElement, chapters: readonly PlayerChapter[]): void {
    media.querySelector('track[kind="chapters"]')?.remove();
    if (chapters.length === 0) return;
    const cues = chapters.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.name.replace(/\s+/g, ' ').replace(/-->/g, '->')}`);
    const track = document.createElement('track');
    track.kind = 'chapters';
    track.default = true;
    track.src = `data:text/vtt,${encodeURIComponent(`WEBVTT\n\n${cues.join('\n\n')}\n`)}`;
    media.append(track);
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
