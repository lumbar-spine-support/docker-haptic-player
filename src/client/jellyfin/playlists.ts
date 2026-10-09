import type { JellyfinItemDto, JellyfinItemsResult, JellyfinPlaylist } from './dto';
import { JellyfinRequestError, type JellyfinApi } from './library';

/**
 * Writing playlists, for "save the queue as a playlist".
 *
 * Saves always send the whole list in order. Jellyfin's per-entry calls (move,
 * remove) address entries by an id that two copies of the same item share, so
 * they cannot target one of them.
 */

async function send(api: JellyfinApi, path: string, method: string, body: unknown, what: string): Promise<Response> {
    const res = await api.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new JellyfinRequestError(res.status, what);
    return res;
}

/** Creates a private playlist of the signed-in user holding `itemIds` in order; resolves to its id. */
export async function createPlaylist(api: JellyfinApi, name: string, itemIds: readonly string[]): Promise<string> {
    // Without IsPublic: false Jellyfin makes the playlist readable by every user.
    const res = await send(api, '/Playlists', 'POST',
        { Name: name, Ids: itemIds, UserId: api.userId, IsPublic: false }, 'Creating a playlist');
    const { Id } = await res.json() as { Id: string };
    return Id;
}

/** Replaces the entries of a playlist with `itemIds`, in order. */
export async function replacePlaylistItems(api: JellyfinApi, playlistId: string, itemIds: readonly string[]): Promise<void> {
    await send(api, `/Playlists/${encodeURIComponent(playlistId)}`, 'POST', { Ids: itemIds }, 'Saving a playlist');
}

/**
 * Whether overwriting a playlist loses nothing: the signed-in user may edit it
 * and Jellyfin still holds exactly the entries HAPPY loaded. HAPPY only shows
 * entries from its own libraries, so a playlist with others (or one changed
 * elsewhere since) must not be overwritten with what HAPPY saw.
 */
export async function canOverwritePlaylist(api: JellyfinApi, playlistId: string, loadedItemIds: readonly string[]): Promise<boolean> {
    const id = encodeURIComponent(playlistId);
    const [playlist, user] = await Promise.all([
        api.request(`/Playlists/${id}`),
        api.request(`/Playlists/${id}/Users/${encodeURIComponent(api.userId)}`),
    ]);
    if (!playlist.ok || !user.ok) return false;
    const { ItemIds } = await playlist.json() as { ItemIds?: string[] };
    const { CanEdit } = await user.json() as { CanEdit?: boolean };
    return CanEdit === true
        && ItemIds?.length === loadedItemIds.length
        && ItemIds.every((itemId, index) => itemId === loadedItemIds[index]);
}

/** One playlist with its entries, as the library loader reads them. */
export async function loadPlaylist(api: JellyfinApi, playlistId: string): Promise<JellyfinPlaylist> {
    const user = encodeURIComponent(api.userId);
    const id = encodeURIComponent(playlistId);
    const [itemRes, entriesRes] = await Promise.all([
        api.request(`/Items/${id}?userId=${user}`),
        api.request(`/Playlists/${id}/Items?userId=${user}`),
    ]);
    if (!itemRes.ok) throw new JellyfinRequestError(itemRes.status, 'Playlist fetch');
    if (!entriesRes.ok) throw new JellyfinRequestError(entriesRes.status, 'Playlist entries');
    const item = await itemRes.json() as JellyfinItemDto;
    const { Items: entries } = await entriesRes.json() as JellyfinItemsResult;
    return { item, entries };
}
