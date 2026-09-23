import type { AlbumInfo, FunscriptType, PlaylistInfo, TrackInfo } from './types';

export type MediaTypeFilters = {
  albums: boolean;
  playlists: boolean;
  tracks: boolean;
  videos: boolean;
};

export type HapticFilters = {
  stroker: boolean;
  buttplug: boolean;
  vibrator: boolean;
  estim: boolean;
  machine: boolean;
};

export function normalizeMediaTypeFilters(filters: Partial<MediaTypeFilters>): MediaTypeFilters {
  const albums = filters.albums ?? true;
  const playlists = filters.playlists ?? true;
  const tracks = filters.tracks ?? true;
  const videos = filters.videos ?? true;

  const anySelected = albums || playlists || tracks || videos;
  if (!anySelected) {
    return {
      albums: true,
      playlists: true,
      tracks: true,
      videos: true,
    };
  }

  return {
    albums,
    playlists,
    tracks,
    videos,
  };
}

export function displayMediaTypeFilters(filters: Partial<MediaTypeFilters>): MediaTypeFilters {
  const normalized = normalizeMediaTypeFilters(filters);
  const allEnabled = normalized.albums && normalized.playlists && normalized.tracks && normalized.videos;
  if (allEnabled) {
    return {
      albums: false,
      playlists: false,
      tracks: false,
      videos: false,
    };
  }

  return normalized;
}

export function normalizeHapticFilters(filters: Partial<HapticFilters>): HapticFilters {
  const stroker = filters.stroker ?? true;
  const buttplug = filters.buttplug ?? true;
  const vibrator = filters.vibrator ?? true;
  const estim = filters.estim ?? true;
  const machine = filters.machine ?? true;

  const anySelected = stroker || buttplug || vibrator || estim || machine;
  if (!anySelected) {
    return {
      stroker: true,
      buttplug: true,
      vibrator: true,
      estim: true,
      machine: true,
    };
  }

  return {
    stroker,
    buttplug,
    vibrator,
    estim,
    machine,
  };
}

export function displayHapticFilters(filters: Partial<HapticFilters>): HapticFilters {
  const normalized = normalizeHapticFilters(filters);
  const allEnabled = normalized.stroker && normalized.buttplug && normalized.vibrator && normalized.estim && normalized.machine;
  if (allEnabled) {
    return {
      stroker: false,
      buttplug: false,
      vibrator: false,
      estim: false,
      machine: false,
    };
  }

  return normalized;
}

/** Prefix marking an active filter entry as an artist filter rather than a real file tag. */
export const ARTIST_TAG_PREFIX = 'artist:';

export function makeArtistTag(artist: string): string {
  return `${ARTIST_TAG_PREFIX}${artist}`;
}

export function isArtistTag(tag: string): boolean {
  return tag.toLowerCase().startsWith(ARTIST_TAG_PREFIX);
}

export function artistTagValue(tag: string): string {
  return isArtistTag(tag) ? tag.slice(ARTIST_TAG_PREFIX.length) : tag;
}

/** Splits a list of active filter entries into plain tags and artist names. */
export function splitActiveTags(activeTags: readonly string[]): { tags: string[]; artists: string[] } {
  const tags: string[] = [];
  const artists: string[] = [];
  for (const entry of activeTags) {
    if (isArtistTag(entry)) artists.push(artistTagValue(entry));
    else tags.push(entry);
  }
  return { tags, artists };
}

/** Artist filters are OR-ed together, since a single item rarely has more than one artist. */
function matchesArtists(available: Iterable<string>, artists: readonly string[]): boolean {
  if (artists.length === 0) return true;
  const normalized = new Set<string>();
  for (const artist of available) normalized.add(artist.toLowerCase());
  return artists.some((artist) => normalized.has(artist.toLowerCase()));
}

export function trackMatchesActiveTags(
  trackTags: readonly string[],
  activeTags: readonly string[],
  trackArtist = '',
): boolean {
  if (activeTags.length === 0) return true;
  const { tags, artists } = splitActiveTags(activeTags);
  if (!matchesArtists([trackArtist], artists)) return false;
  const normalizedTrackTags = new Set(trackTags.map((tag) => tag.toLowerCase()));
  return tags.every((tag) => normalizedTrackTags.has(tag.toLowerCase()));
}

export function trackMatchesHapticFilters(
  track: Pick<TrackInfo, 'funscripts'>,
  allowedHapticTypes: readonly FunscriptType[],
): boolean {
  if (allowedHapticTypes.length === 0) return true;
  const available = new Set(track.funscripts.map((funscript) => funscript.type));
  return allowedHapticTypes.every((type) => available.has(type));
}

export function albumMatchesActiveTags(
  album: Pick<AlbumInfo, 'trackIds'> & { artist?: string },
  tracksById: Map<string, Pick<TrackInfo, 'tags' | 'funscripts'> & { artist?: string }>,
  activeTags: readonly string[],
): boolean {
  if (activeTags.length === 0) return true;
  const { tags, artists } = splitActiveTags(activeTags);
  const available = new Set<string>();
  const availableArtists = new Set<string>();
  if (album.artist) availableArtists.add(album.artist);
  for (const trackId of album.trackIds) {
    const track = tracksById.get(trackId);
    if (!track) continue;
    if (track.artist) availableArtists.add(track.artist);
    for (const tag of track.tags) {
      available.add(tag.toLowerCase());
    }
  }
  if (!matchesArtists(availableArtists, artists)) return false;
  return tags.every((tag) => available.has(tag.toLowerCase()));
}

export function albumMatchesHapticFilters(
  album: Pick<AlbumInfo, 'trackIds'>,
  tracksById: Map<string, Pick<TrackInfo, 'funscripts'>>,
  allowedHapticTypes: readonly FunscriptType[],
): boolean {
  if (allowedHapticTypes.length === 0) return true;
  const available = new Set<FunscriptType>();
  for (const trackId of album.trackIds) {
    const track = tracksById.get(trackId);
    if (!track) continue;
    for (const funscript of track.funscripts) {
      available.add(funscript.type);
    }
  }
  return allowedHapticTypes.every((type) => available.has(type));
}

export function playlistMatchesActiveTags(
  playlist: Pick<PlaylistInfo, 'entries'>,
  tracksById: Map<string, Pick<TrackInfo, 'tags' | 'funscripts'> & { artist?: string }>,
  activeTags: readonly string[],
): boolean {
  if (activeTags.length === 0) return true;
  const { tags, artists } = splitActiveTags(activeTags);
  const available = new Set<string>();
  const availableArtists = new Set<string>();
  for (const entry of playlist.entries) {
    if (entry.artist) availableArtists.add(entry.artist);
    const track = tracksById.get(entry.trackId);
    if (!track) continue;
    if (track.artist) availableArtists.add(track.artist);
    for (const tag of track.tags) {
      available.add(tag.toLowerCase());
    }
  }
  if (!matchesArtists(availableArtists, artists)) return false;
  return tags.every((tag) => available.has(tag.toLowerCase()));
}

export function playlistMatchesHapticFilters(
  playlist: Pick<PlaylistInfo, 'entries'>,
  tracksById: Map<string, Pick<TrackInfo, 'funscripts'>>,
  allowedHapticTypes: readonly FunscriptType[],
): boolean {
  if (allowedHapticTypes.length === 0) return true;
  const available = new Set<FunscriptType>();
  for (const entry of playlist.entries) {
    const track = tracksById.get(entry.trackId);
    if (!track) continue;
    for (const funscript of track.funscripts) {
      available.add(funscript.type);
    }
  }
  return allowedHapticTypes.every((type) => available.has(type));
}
