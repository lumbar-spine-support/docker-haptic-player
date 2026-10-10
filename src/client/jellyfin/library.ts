import type { LibraryResponse } from '../../shared/types';
import type { HappyFunscriptListing, JellyfinItemDto, JellyfinItemsResult, JellyfinPlaylist, JellyfinUserDataDto } from './dto';
import { buildLibrary, type MapOptions } from './mapper';

/** What the loader needs from a signed-in Jellyfin session; the browser connection and the integration tests both provide it. */
export interface JellyfinApi {
    readonly userId: string;
    request(path: string, init?: RequestInit): Promise<Response>;
}

export interface LoadOptions extends MapOptions {
    /** Jellyfin libraries to load, from the plugin settings; empty or absent for all. */
    libraryIds?: readonly string[];
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
    const { Items } = await getJson<JellyfinItemsResult>(api, `/Items?userId=${user}&Recursive=true&IncludeItemTypes=Playlist&EnableUserData=true&Fields=CanDelete`, 'Playlist listing');
    return Promise.all(Items.map(async (item) => {
        const { Items: entries } = await getJson<JellyfinItemsResult>(
            api, `/Playlists/${encodeURIComponent(item.Id)}/Items?userId=${user}`, 'Playlist entries');
        return { item, entries };
    }));
}

/**
 * Playable items of the selected libraries (one request each), or of all libraries. Items in more
 * than one selected library come once; the library view sorts on its own, so order across libraries
 * does not matter.
 */
async function loadItems(api: JellyfinApi, libraryIds: readonly string[]): Promise<JellyfinItemDto[]> {
    const query = `/Items?userId=${encodeURIComponent(api.userId)}&Recursive=true&IncludeItemTypes=${PLAYABLE_TYPES}`
        + `&Fields=${ITEM_FIELDS}&SortBy=SortName&EnableImageTypes=Primary&ImageTypeLimit=1&EnableUserData=true`
        + '&EnableTotalRecordCount=false';
    if (libraryIds.length === 0) return (await getJson<JellyfinItemsResult>(api, query, 'Library fetch')).Items;
    const results = await Promise.all(libraryIds.map((id) =>
        getJson<JellyfinItemsResult>(api, `${query}&ParentId=${encodeURIComponent(id)}`, 'Library fetch')));
    const items = new Map<string, JellyfinItemDto>();
    for (const { Items } of results) for (const item of Items) if (!items.has(item.Id)) items.set(item.Id, item);
    return [...items.values()];
}

/**
 * Loads everything the client holds in memory: the playable items of the selected libraries, their
 * funscripts, and playlists (reduced to entries from those libraries).
 */
export async function loadLibrary(api: JellyfinApi, options: LoadOptions): Promise<LibraryResponse> {
    const [items, funscripts, playlists] = await Promise.all([
        loadItems(api, options.libraryIds ?? []),
        loadFunscripts(api),
        loadPlaylists(api),
    ]);
    return buildLibrary(items, funscripts, playlists, options);
}

/**
 * Marks or unmarks an item as a favorite of the signed-in user, the same flag Jellyfin's own
 * clients show. Returns the state Jellyfin stored.
 */
export async function setFavorite(api: JellyfinApi, itemId: string, favorite: boolean): Promise<boolean> {
    const res = await api.request(
        `/UserFavoriteItems/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(api.userId)}`,
        { method: favorite ? 'POST' : 'DELETE' });
    if (!res.ok) throw new JellyfinRequestError(res.status, favorite ? 'Adding a favorite' : 'Removing a favorite');
    const data = await res.json().catch(() => null) as JellyfinUserDataDto | null;
    return typeof data?.IsFavorite === 'boolean' ? data.IsFavorite : favorite;
}
