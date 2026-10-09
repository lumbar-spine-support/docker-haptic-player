import type { ChapterSource, FunscriptInfo, LibraryResponse, PlaylistInfo, TrackInfo, TrickplayInfo } from '../../shared/types';
import { buildAlbums } from '../../shared/albums';
import { normalizeChapters } from '../../shared/chapters';
import { parseFunscriptName, type FunscriptSuffixes } from '../../shared/funscriptNames';
import type { HappyFunscriptListing, JellyfinItemDto, JellyfinPlaylist } from './dto';

const TICKS_PER_SECOND = 10_000_000;

/** Preferred storyboard thumbnail width; the closest resolution Jellyfin generated is used. */
const PREFERRED_TRICKPLAY_WIDTH = 320;

export interface MapOptions {
    funscriptSuffixes: FunscriptSuffixes;
    chapterSourcePriority: readonly ChapterSource[];
}

const basename = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

function stem(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.slice(0, dot) : filename;
}

/** Tags and genres both act as HAPPY tags: Jellyfin reads multi-value ID3 genres automatically, tags only from NFO or its editor. */
function tagsOf(item: JellyfinItemDto): string[] {
    const seen = new Map<string, string>();
    for (const tag of [...(item.Tags ?? []), ...(item.Genres ?? [])]) {
        const trimmed = tag.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
    }
    return [...seen.values()];
}

function funscriptsOf(scripts: HappyFunscriptListing[string] | undefined, suffixes: FunscriptSuffixes): FunscriptInfo[] {
    const result: FunscriptInfo[] = [];
    for (const script of scripts ?? []) {
        const parsed = parseFunscriptName(script.FileName, suffixes);
        if (!parsed) continue;
        result.push({
            key: script.Key,
            filename: script.FileName,
            type: parsed.type,
            ...(parsed.sub ? { sub: parsed.sub } : {}),
        });
    }
    return result.sort((a, b) => a.filename.localeCompare(b.filename));
}

/** The resolution closest to {@link PREFERRED_TRICKPLAY_WIDTH} of the first media source. */
export function trickplayOf(item: JellyfinItemDto): TrickplayInfo | undefined {
    for (const [mediaSourceId, resolutions] of Object.entries(item.Trickplay ?? {})) {
        const best = Object.entries(resolutions)
            .map(([resolution, info]) => ({ resolution: Number(resolution), info }))
            .filter(({ resolution, info }) => Number.isFinite(resolution) && info.ThumbnailCount > 0 && info.Interval > 0)
            .sort((a, b) => Math.abs(a.resolution - PREFERRED_TRICKPLAY_WIDTH) - Math.abs(b.resolution - PREFERRED_TRICKPLAY_WIDTH))[0];
        if (!best) continue;
        return {
            mediaSourceId,
            resolution: best.resolution,
            width: best.info.Width,
            height: best.info.Height,
            columns: best.info.TileWidth,
            rows: best.info.TileHeight,
            count: best.info.ThumbnailCount,
            intervalSeconds: best.info.Interval / 1000,
        };
    }
    return undefined;
}

/** Maps one Jellyfin item to a HAPPY track, or null for anything that is not audio or video. */
export function toTrack(item: JellyfinItemDto, scripts: HappyFunscriptListing[string] | undefined, options: MapOptions): TrackInfo | null {
    const type = item.MediaType === 'Video' ? 'video' : item.MediaType === 'Audio' ? 'audio' : null;
    if (!type) return null;

    const filename = item.Path ? basename(item.Path) : '';
    const durationSeconds = Math.max(0, Math.floor((item.RunTimeTicks ?? 0) / TICKS_PER_SECOND));
    const artworkTag = item.ImageTags?.Primary ?? null;
    const track: TrackInfo = {
        id: item.Id,
        type,
        title: item.Name?.trim() || stem(filename) || item.Id,
        filename,
        description: item.Overview ?? '',
        artist: item.AlbumArtist?.trim() || item.Artists?.join(', ') || '',
        album: item.Album?.trim() ?? '',
        year: item.ProductionYear ? String(item.ProductionYear) : '',
        trackNumber: item.IndexNumber ?? null,
        hasArtwork: artworkTag !== null,
        artworkTag,
        durationSeconds,
        funscripts: funscriptsOf(scripts, options.funscriptSuffixes),
        tags: tagsOf(item),
        isFavorite: item.UserData?.IsFavorite === true,
    };

    // Funscript chapters need the script files, so they are resolved once the track is opened.
    if (options.chapterSourcePriority.includes('embedded') && item.Chapters?.length) {
        const chapters = normalizeChapters(
            item.Chapters.map((c) => ({ name: c.Name ?? '', start: c.StartPositionTicks / TICKS_PER_SECOND })),
            durationSeconds,
        );
        if (chapters.length) {
            track.chapters = chapters;
            track.chaptersSource = 'embedded';
        }
    }

    const trickplay = type === 'video' ? trickplayOf(item) : undefined;
    if (trickplay) track.trickplay = trickplay;
    return track;
}

function toPlaylist(playlist: JellyfinPlaylist, tracksById: Map<string, TrackInfo>): PlaylistInfo {
    const entries = playlist.entries
        .map((entry) => tracksById.get(entry.Id))
        .filter((track): track is TrackInfo => track !== undefined)
        .map((track, order) => ({ order, trackId: track.id, title: track.title, artist: track.artist, album: track.album }));
    return {
        id: playlist.item.Id,
        name: playlist.item.Name?.trim() || 'Playlist',
        year: playlist.item.ProductionYear ? String(playlist.item.ProductionYear) : '',
        durationSeconds: entries.reduce((sum, entry) => sum + (tracksById.get(entry.trackId)?.durationSeconds ?? 0), 0),
        entries,
        isFavorite: playlist.item.UserData?.IsFavorite === true,
    };
}

/** Builds the in-memory library from Jellyfin items, the plugin's funscript listing and playlists. */
export function buildLibrary(
    items: readonly JellyfinItemDto[],
    funscripts: HappyFunscriptListing,
    playlists: readonly JellyfinPlaylist[],
    options: MapOptions,
): LibraryResponse {
    const media = items
        .map((item) => toTrack(item, funscripts[item.Id], options))
        .filter((track): track is TrackInfo => track !== null);
    const tracksById = new Map(media.map((track) => [track.id, track]));
    return {
        tracks: media.filter((track) => track.type === 'audio'),
        videos: media.filter((track) => track.type === 'video'),
        albums: buildAlbums(media),
        playlists: playlists.map((playlist) => toPlaylist(playlist, tracksById)).filter((playlist) => playlist.entries.length > 0),
    };
}
