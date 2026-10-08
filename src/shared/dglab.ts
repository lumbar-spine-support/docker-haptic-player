/** Dungeon Lab WebSocket route for the relay between DG-Lab app and controller. */
export const DGLAB_WS_PATH = '/ws/dglab';

/**
 * How long the relay keeps a paired DG-Lab app after the controller's socket closes.
 *
 * Shared so the client only auto-reconnects while the app is still held by the relay.
 */
export const DGLAB_DETACH_GRACE_MS = 5 * 60_000;

/** Subprotocol a HAPPY tab offers so the relay can select it without echoing the token. */
export const DGLAB_PROTOCOL = 'happy';

/** A HAPPY tab authenticates its relay connection by offering `jellyfin.<access token>` as a subprotocol. */
export const DGLAB_AUTH_PROTOCOL_PREFIX = 'jellyfin.';
