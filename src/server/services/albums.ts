import type { AlbumInfo, TrackInfo } from '../../shared/types';
import { filenameToId } from '../utils/ids';

function albumIdFromName(album: string, artist: string): string {
    return filenameToId(`album:${artist}\u0000${album}`);
}

function compareTrackEntries(a: TrackInfo, b: TrackInfo): number {
    const aTrackNumber = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
    const bTrackNumber = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
    if (aTrackNumber !== bTrackNumber) return aTrackNumber - bTrackNumber;

    const yearCmp = a.year.localeCompare(b.year);
    if (yearCmp !== 0) return yearCmp;

    const titleCmp = a.title.localeCompare(b.title);
    if (titleCmp !== 0) return titleCmp;

    return a.filename.localeCompare(b.filename);
}

/** Group tracks by artist + album tag, ordered by track number. */
export function buildAlbums(tracks: TrackInfo[]): AlbumInfo[] {
    const albumMap = new Map<string, TrackInfo[]>();

    for (const track of tracks) {
        if (!track.album.trim()) continue;
        const key = `${track.artist}\u0000${track.album}`;
        const bucket = albumMap.get(key) ?? [];
        bucket.push(track);
        albumMap.set(key, bucket);
    }

    return [...albumMap.entries()]
        .map(([key, albumTracks]) => {
            const [artist, album] = key.split('\u0000');
            const sortedTracks = [...albumTracks].sort(compareTrackEntries);
            // Only tracks that actually carry a cover; otherwise the client would request a guaranteed 404.
            const coverTrack = sortedTracks.find((track) => track.hasArtwork) ?? null;

            return {
                id: albumIdFromName(album, artist),
                type: 'album',
                album,
                artist,
                year: sortedTracks[0]?.year ?? '',
                durationSeconds: sortedTracks.reduce((sum, track) => sum + track.durationSeconds, 0),
                title: album,
                trackIds: sortedTracks.map((track) => track.id),
                trackCount: sortedTracks.length,
                coverTrackId: coverTrack?.id ?? null,
            } satisfies AlbumInfo;
        })
        .sort((a, b) => a.title.localeCompare(b.title));
}
