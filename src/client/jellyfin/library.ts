import type { LibraryResponse } from '../../shared/types';
import type { HappyFunscriptListing, JellyfinItemsResult, JellyfinPlaylist } from './dto';
import { buildLibrary, type MapOptions } from './mapper';

/** What the loader needs from a signed-in Jellyfin session; the browser connection and the integration tests both provide it. */
export interface JellyfinApi {
    readonly userId: string;
    request(path: string, init?: RequestInit): Promise<Response>;
}

/** Item types that can be played; `MediaType` then decides between audio and video. */
const PLAYABLE_TYPES = 'Audio,AudioBook,Video,Movie,MusicVideo,Episode';
const ITEM_FIELDS = 'Path,Tags,Genres,Overview,Chapters,Trickplay';

export class JellyfinRequestError extends Error {
    constructor(readonly status: number, what: string) {
        super(`${what} failed with HTTP ${status}`);
    }
}

async function getJson<T>(api: JellyfinApi, path: string, what: string): Promise<T> {
    const res = await api.request(path);
    if (!res.ok) throw new JellyfinRequestError(res.status, what);
    return res.json() as Promise<T>;
}

/** Funscripts come from the HAPPY plugin; without it the library still loads, just without haptics. */
async function loadFunscripts(api: JellyfinApi): Promise<HappyFunscriptListing> {
    const res = await api.request('/Happy/Funscripts');
    if (res.status === 404) {
        console.warn('[jellyfin] The HAPPY plugin is not installed on the Jellyfin server; no funscripts available.');
        return {};
    }
    if (!res.ok) throw new JellyfinRequestError(res.status, 'Funscript listing');
    return res.json() as Promise<HappyFunscriptListing>;
}

async function loadPlaylists(api: JellyfinApi): Promise<JellyfinPlaylist[]> {
    const user = encodeURIComponent(api.userId);
    const { Items } = await getJson<JellyfinItemsResult>(api, `/Items?userId=${user}&Recursive=true&IncludeItemTypes=Playlist`, 'Playlist listing');
    return Promise.all(Items.map(async (item) => {
        const { Items: entries } = await getJson<JellyfinItemsResult>(
            api, `/Playlists/${encodeURIComponent(item.Id)}/Items?userId=${user}`, 'Playlist entries');
        return { item, entries };
    }));
}

/** Loads everything the client holds in memory: all playable items, their funscripts, and playlists. */
export async function loadLibrary(api: JellyfinApi, options: MapOptions): Promise<LibraryResponse> {
    const user = encodeURIComponent(api.userId);
    const [items, funscripts, playlists] = await Promise.all([
        getJson<JellyfinItemsResult>(api,
            `/Items?userId=${user}&Recursive=true&IncludeItemTypes=${PLAYABLE_TYPES}&Fields=${ITEM_FIELDS}`
            + '&SortBy=SortName&EnableImageTypes=Primary&ImageTypeLimit=1&EnableTotalRecordCount=false',
            'Library fetch'),
        loadFunscripts(api),
        loadPlaylists(api),
    ]);
    return buildLibrary(items.Items, funscripts, playlists, options);
}
