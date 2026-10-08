import type { AlbumInfo, TrackInfo } from './types';

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

/** Stable, URL-safe album id from artist and album name (two 32-bit FNV-1a hashes). */
export function albumId(artist: string, album: string): string {
  const key = `${artist}\u0000${album}`;
  const fnv = (seed: number): string => {
    let hash = seed;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  };
  return `album-${fnv(0x811c9dc5)}${fnv(0x050c5d1f)}`;
}

/**
 * Group tracks by artist + album tag, ordered by track number.
 *
 * Jellyfin only builds album entities for Music libraries; HAPPY groups itself so audiobook
 * and mixed libraries get albums too.
 */
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
        id: albumId(artist, album),
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
