/** Types shared between the server API and the browser client. */

export type Album = 'album';
export type Single = 'single';
export type Audio = 'audio';
export type Video = 'video';
export type Playlist = 'playlist';

export type Stroker = 'stroker';
export type Buttplug = 'buttplug';
export type Vibrator = 'vibrator';
export type Estim = 'estim';
export type Machine = 'machine';

/** Identifies the role/channel of a Funscript file. */
export type FunscriptType = Stroker | Buttplug | Vibrator | Estim | Machine;

/** Metadata for a single Funscript companion file. */
export interface FunscriptInfo {
  /** File path relative to the media directory. */
  filename: string;
  type: FunscriptType;
  /** Optional subcategory from `<stem>.<type>.<sub>.funscript`, e.g. `nipples`. */
  sub?: string;
}

export interface LibraryItemBase {
  /** Stable identifier derived from the filename (URL-safe base64). */
  id: string;
  title: string;
  type: Audio | Video | Album;
}

/** All information the client needs to render a track card or open the player. */
export interface TrackInfo extends LibraryItemBase {
  /** 'video' for video files (e.g. mp4); the player and library UI treat them like tracks. */
  type: Audio | Video;
  /** Track file path relative to the media directory, including extension. */
  filename: string;
  /** Relative path of the optional markdown description companion file. */
  descriptionFilename: string | null;
  artist: string;
  album: string;
  year: string;
  trackNumber: number | null;
  comment: string;
  hasArtwork: boolean;
  durationSeconds: number;
  funscripts: FunscriptInfo[];
  tags: string[];
}

export interface AlbumInfo extends LibraryItemBase {
  type: Album;
  album: string;
  artist: string;
  year: string;
  durationSeconds: number;
  trackIds: string[];
  trackCount: number;
  coverTrackId: string | null;
}

export interface PlaylistEntry {
  order: number;
  path: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
}

export interface PlaylistInfo {
  id: string;
  filename: string;
  name: string;
  year: string;
  durationSeconds: number;
  entries: PlaylistEntry[];
}

/** A single action entry inside a Funscript file. */
export interface FunscriptAction {
  /** Timestamp in milliseconds. */
  at: number;
  /** Position value 0–100. */
  pos: number;
}

/** Parsed representation of a Funscript JSON file. */
export interface Funscript {
  version?: string;
  actions: FunscriptAction[];
}

/** Response shape of GET /api/library */
export interface LibraryResponse {
  tracks: TrackInfo[];
  videos: TrackInfo[];
  albums: AlbumInfo[];
  playlists: PlaylistInfo[];
}

/** Response shape of GET /api/version */
export interface VersionInfo {
  version: string;
  /** Release channel of the running build: `stable`, `preview`, or `dev`. */
  channel: string;
  commit: string | null;
  builtAt: string | null;
}

export type QueueSource =
  | { type: Single }
  | { type: Album; id: string }
  | { type: Playlist; id: string };

/** Everything a player slot needs to render one track. */
export interface PlaybackRequest {
  /** Library id of the track, used to tell the two player slots apart. */
  id: string;
  type: Audio | Video;
  src: string;
  title: string;
  artist: string;
  year: string;
  poster: string;
}