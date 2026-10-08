import type { TrackInfo, TrickplayInfo } from '../../shared/types';
import { buildStoryboardVtt } from '../../shared/webvtt';

/** Where to reach Jellyfin and with which access token. */
export interface JellyfinEndpoint {
    serverUrl: string;
    token: string;
}

/** Longest edge requested for cover art; Jellyfin scales and caches it server side. */
const ARTWORK_MAX_SIZE = 1000;

/**
 * Original file, never transcoded: haptic timing relies on the element's own clock and VR on the
 * full-resolution frame. The token sits in the query because media elements cannot send headers,
 * which also lets remote playback receivers (Chromecast, AirPlay) fetch the stream.
 */
export function streamUrl(endpoint: JellyfinEndpoint, track: Pick<TrackInfo, 'id' | 'type'>): string {
    const kind = track.type === 'video' ? 'Videos' : 'Audio';
    return `${endpoint.serverUrl}/${kind}/${encodeURIComponent(track.id)}/stream?static=true&api_key=${encodeURIComponent(endpoint.token)}`;
}

/** Primary image; the tag makes the URL change whenever the image does, so it caches well. Images need no token. */
export function imageUrl(serverUrl: string, itemId: string, tag: string | null | undefined): string {
    const query = new URLSearchParams({ maxWidth: String(ARTWORK_MAX_SIZE), maxHeight: String(ARTWORK_MAX_SIZE), quality: '90' });
    if (tag) query.set('tag', tag);
    return `${serverUrl}/Items/${encodeURIComponent(itemId)}/Images/Primary?${query}`;
}

export function trickplaySheetUrl(endpoint: JellyfinEndpoint, itemId: string, trickplay: TrickplayInfo, index: number): string {
    const query = new URLSearchParams({ mediaSourceId: trickplay.mediaSourceId, api_key: endpoint.token });
    return `${endpoint.serverUrl}/Videos/${encodeURIComponent(itemId)}/Trickplay/${trickplay.resolution}/${index}.jpg?${query}`;
}

/** Storyboard WebVTT for Video.js thumbnails, pointing at Jellyfin's trickplay sheets. */
export function trickplayVtt(endpoint: JellyfinEndpoint, track: Pick<TrackInfo, 'id' | 'durationSeconds' | 'trickplay'>): string | null {
    const trickplay = track.trickplay;
    if (!trickplay) return null;
    const perSheet = trickplay.columns * trickplay.rows;
    return buildStoryboardVtt({
        durationSeconds: track.durationSeconds || trickplay.count * trickplay.intervalSeconds,
        intervalSeconds: trickplay.intervalSeconds,
        columns: trickplay.columns,
        rows: trickplay.rows,
        tileWidth: trickplay.width,
        tileHeight: trickplay.height,
        sheets: Math.ceil(trickplay.count / perSheet),
    }, (index) => trickplaySheetUrl(endpoint, track.id, trickplay, index));
}
