# Architecture

> Diagrams and step-by-step use cases (pairing, playback, library load, login) live in [docs/developer/](docs/developer/README.md).

## Overview

This is a TypeScript application split into two runtime layers, backed by a Jellyfin server:

- **Server (`src/server/`)**: serves the static client, the client-visible configuration, the built-in docs and the optional DG-Lab relay. It has no media library of its own.
- **Client (`src/client/`)**: signs in to Jellyfin, builds the library model from Jellyfin's API, and renders the Bootstrap UI, routing, playback, haptic synchronization and device control in the browser.
- **Jellyfin + the HAPPY plugin (`jellyfin-plugin/`)**: Jellyfin owns scanning, metadata, artwork, chapters, trickplay thumbnails, users and streaming. The plugin adds the one thing Jellyfin does not know: funscripts next to the media files.

The server is intentionally stateless with respect to playback. All live playback, footer state, haptic timing, and Intiface device connection state live in the browser.

Media always plays **directly** (`/Videos|Audio/{id}/stream?static=true`), never transcoded: haptic
timing follows the media element's own clock, and VR needs the full-resolution frame. Chromecast and
other remote playback receivers fetch that URL themselves; the Jellyfin access token travels in its
`api_key` query parameter, so no separate media token is needed.

The one carve-out is the optional **DG-Lab V4 relay** (`/ws/dglab`). A browser cannot accept
WebSocket connections, so pairing a phone-hosted DG-Lab app with the player needs a meeting
point. The relay is a dumb passthrough: it pairs one controller with one app and
forwards opaque payloads. It never parses a device command, so all haptic logic still lives in
the browser and all safety limits still live in the DG-Lab app.

HAPPY is single-user, so the relay has exactly one controller slot with a random id created at
startup. Any authenticated tab that connects takes the slot (the previous one is closed as
`replaced`), so the pairing URL survives reloads and switching devices. The slot also outlives
its socket by a grace period: switching to the DG-Lab app backgrounds the browser and mobile
Chrome may close the WebSocket, so the relay keeps the app, accepts one that arrives meanwhile,
and hands it to the tab when it returns. A newly connecting app likewise replaces the previous one.

## High-level system architecture

### Server responsibilities

- Load runtime configuration from `config/settings.yaml`
- Expose API routes for:
  - `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`
  - `/api/config` (the client-visible half of the configuration only, including `JELLYFIN_URL`)
  - `/api/version`
  - `/api/docs` (the user docs shown in the app)
  - `/ws/dglab` (WebSocket relay, only when `DGLAB_ENABLED` is on)
- Serve compiled frontend assets from `public/`
- Gate every asset and API route behind HAPPY's own access token while `PASSWORD` is set
- Write a level-filtered log of startup, connection, and authentication events to the docker console

### Client responsibilities

- Sign in to Jellyfin and keep the session token
- Load the library from Jellyfin and the funscript listing from the HAPPY plugin
- Render library, album, playlist, and file views
- Maintain the **two-player model**
- Keep the persistent footer in sync with the active playback player
- Drive haptic output through Buttplug/Intiface
- Drive haptic output through the DG-Lab V4 relay when enabled
- Manage local UI preferences in `localStorage`

## Haptic backends

`HapticBackend` (`src/client/components/haptic/backend.ts`) is the single interface the sync
engine and the settings UI talk to. Two implementations exist:

- `ButtplugClientManager` — Intiface over WebSocket.
- `CoyoteBackend` — DG-Lab Coyote 3.0 through the relay. Funscript position maps to channel
  strength; the waveform is a flat carrier, because strength only scales pulses the device is
  already emitting.

`HapticBackendRegistry` implements the same interface by fanning out across both. It is used
for the combined connection status (`DeviceStatus`) and for stopping every device at once.
Playback does not go through it: each backend gets its own `FunscriptSync`, so one funscript
can drive an Intiface toy and a Coyote simultaneously with separate delays.

### Coyote update rate

The Coyote consumes one pulse frame per ~100 ms tick, so roughly 10 Hz is the ceiling for how
closely it can track a dense script. A frame nominally carries four 25 ms amplitude sub-steps,
which would allow 40 Hz, but every waveform DG-Lab ships holds amplitude constant across a
frame and modulating the sub-steps produced no output on real hardware. Pulse batches are sent
with `im: true` so each replaces the last: appending instead builds an unbounded backlog and
the device ends up playing minutes-old frames.

## Two-player model

The client keeps **two Video.js instances alive at runtime**:

1. **Playback player** (`player`)
   - Owns the currently playing media
   - Owns the persistent footer bar
   - Owns Media Session, PiP, autoplay, prev/next navigation, and haptic sync

2. **Preview player** (`previewPlayer`)
   - Belongs to the currently browsed file page
   - Loads a browsed file in a stopped state
   - Never steals the footer or playback state just because the user navigated

### Why this exists

This prevents route navigation from interrupting playback:

- Browsing from file A to file B does **not** stop file A
- Opening file B does **not** switch the footer to file B
- The footer only changes when the user explicitly starts file B from the page player

### Handoff rule

The preview player becomes the active playback player only through one explicit handoff path:

- user presses play on the focused player slot
- that slot's store reports `paused: false`
- `PlaybackSession` promotes the slot to _active_ and pauses the other slot
- footer, haptics, and track navigation follow the newly active slot

Nothing is re-loaded or re-parented during the handoff, so fullscreen and PiP
state survive it.

Relevant files:

- `src/client/index.ts`
- `src/client/components/player/session.ts`
- `src/client/components/player/controller.ts`
- `src/client/components/player/footer.ts`

## State management and synchronization flow

Client state is coordinated by the `App` class in `src/client/index.ts` together
with `PlaybackSession`, `PlaybackQueue` and `PlaybackController`.

### Core state

- `currentTrackId`: file page the user is browsing
- `PlaybackSession.activeSlot` / `activeTrackId`: slot that owns playback and the footer
- `PlaybackSession.focusedTrackId`: slot shown on the browsed file page
- `PlaybackQueue`: ordered track ids plus the album/playlist they came from
- `pageScripts`: funscripts loaded for the browsed file

### Player slots

`src/client/components/player/session.ts` owns two interchangeable
`<video-player>` elements:

- `activeStore` → the Video.js store driving the footer, haptics and Media Session
- `focusedStore` → the store driving the visible file page player and waveform
- the two indices are equal when the browsed file is also the playing file

### Sync flow

1. Client fetches config from the HAPPY server and the library from Jellyfin, both through `src/client/api.ts`
2. Router state determines whether library/detail/player view is shown
3. Opening a file:
   - updates `currentTrackId`
   - `PlaybackSession.browse()` points the focus at the active slot when the ids
     match, otherwise loads the track into the idle slot
   - loads funscripts for the browsed file and renders its description
4. Starting playback:
   - the focused slot promotes itself to active
   - footer and Media Session metadata follow via `PlaybackController.onActiveTrack`
   - scripts are loaded into the haptic sync engine
5. Footer visibility follows `PlaybackSession.activeRequest`; page-player
   visibility follows the focus index

## Haptic sync lifecycle

The haptic pipeline is:

1. user opens a track
2. client fetches the track's funscripts from the HAPPY plugin by key
3. `FunscriptSync` receives sorted script actions
4. store updates from the active player slot drive sync start/pause/seek/stop
5. device commands are routed through `ButtplugClientManager`

### Synchronization model

`src/client/components/funscriptSync.ts` picks the update style from the _actuator_
that a script's channel is assigned to, not from the script type:

- **Scalar and rotate actuators**
  - interpolate the current value on every tick
  - resend continuously for recovery from dropped writes
- **Linear (stroker) actuators**
  - issue edge-triggered moves
  - lock out new commands until the current move should be complete
  - compute target waypoint duration from the next funscript action

### Resync triggers

The sync engine recalculates output when:

- playback starts
- playback pauses/stops
- user seeks
- haptic delay changes
- update frequency changes
- device assignments change
- devices connect/disconnect

## VR180 playback

VR180 videos (detected from the filename by `src/shared/vrFormat.ts`) are tagged with `data-vr-format` on their `<video-player>`. The `vr` player feature then draws the `<video>` through a WebGL2 canvas as an inline panorama (mouse/touch drag, wheel/pinch zoom, optional gyroscope). Camera math, the shared projection shader and the inline view live in `src/client/components/vr/`; a capture-phase drag guard keeps panorama drags from firing the skin's tap gestures. Haptic sync is independent of the render loop. See [docs/developer/client.md](docs/developer/client.md#vr180-playback).

## Jellyfin data layer

The client talks to Jellyfin directly. `src/client/api.ts` stays the single data facade the rest
of the client calls; behind it, `src/client/jellyfin/` holds the session, loader, mapper and URL
builders.

### Session

`JellyfinConnection` (`connection.ts`) signs in with `POST /Users/AuthenticateByName` and stores the
access token, user id and user name in `localStorage`, keyed to the server address in `JELLYFIN_URL`.
API requests send it in a `MediaBrowser … Token="…"` authorization header. A stable per-browser
`DeviceId` keeps Jellyfin's device list to one entry per browser. A `401` forgets the session and
reloads, which shows the sign-in card (`signIn.ts`) again. Without `JELLYFIN_URL` the app shows a
notice instead of loading.

Media elements cannot send headers, so stream and trickplay sheet URLs carry the token as
`api_key`. Images (`/Items/{id}/Images/Primary`) need no token.

### Library model

`loadLibrary()` (`library.ts`) loads everything once and the client keeps it in memory:

- one `/Items` request for all playable items (`Audio`, `AudioBook`, `Video`, `Movie`, `MusicVideo`, `Episode`) with `Fields=Path,Tags,Genres,Overview,Chapters,Trickplay`; `MediaType` decides audio vs video
- `GET /Happy/Funscripts` from the plugin (a missing plugin logs a warning and the library loads without funscripts)
- Jellyfin playlists and their entries

`buildLibrary()` (`mapper.ts`) turns that into the existing `LibraryResponse` shape:

- the track id is the Jellyfin item id; `filename` is the basename of `Path` and drives VR detection
- tags are Jellyfin `Tags` ∪ `Genres` (case-insensitive), the description is the item `Overview`
- albums are grouped client-side from album artist + album (`src/shared/albums.ts`), because
  Jellyfin only builds album entities for Music libraries
- funscript type and subcategory are parsed client-side from the plugin's file names
  (`src/shared/funscriptNames.ts`, honouring `FUNSCRIPT_SUFFIX_*`)
- embedded chapters come from Jellyfin; funscript `metadata.chapters` are only known once the
  scripts load, and replace them according to `CHAPTER_SOURCE_PRIORITY`
  (`PlaybackSession.updateChapters()` swaps the chapter track without reloading the media)
- trickplay uses the resolution closest to 320 px

### Generated WebVTT and CORS

Video.js reads chapters and timeline thumbnails from `<track>` elements. The client builds both
files itself (`buildChaptersVtt()`, `trickplayVtt()`) and hands them over as `blob:` URLs, which are
same-origin and need no CORS. The storyboard cues point at Jellyfin's trickplay sheets with `#xywh=`
fragments.

Jellyfin is a different origin from HAPPY, so both `<video>` elements and the images drawn into the
playlist collage use `crossorigin="anonymous"`. Without CORS mode the WebGL VR projection could not
upload frames and `canvas.toDataURL()` would throw on a tainted canvas. Jellyfin answers with
`Access-Control-Allow-Origin: *`; no cookies are involved.

## Gallery rendering with large libraries

The client holds the whole library in memory and does all searching, tag filtering and sorting
locally, which keeps those interactions instant. The scaling risk is therefore not the JSON payload
but the number of cover images a render puts into the DOM.

Covers are requested lazily rather than eagerly:

- `card.html` and `media-row.html` mark every cover `loading="lazy" decoding="async"`.
- Sizing is left entirely to CSS: `.track-art` pins `aspect-ratio: 1 / 1` and `.track-art-thumb` a
  fixed 40px box, so the placeholder already occupies its final layout before the image arrives.
  That reserved box is what lets the browser tell which covers are off-screen; without it the grid
  would collapse into the viewport and every image would count as visible.
  Do **not** add `width`/`height` attributes to these tags: they map to CSS presentational hints,
  and since `.track-art` sets only `width`, the `height` hint would win and stretch square covers
  into rectangles while suppressing `aspect-ratio`.
- `renderTrackArt()` is the single place that decides between a real URL and the inline
  `FALLBACK_ART_DATA_URI` placeholder. It emits a request only when `hasArtwork` is true, so
  art-less media costs no round trip at all. Album covers point at `coverTrackId`, which album
  grouping leaves `null` when no track in the album carries a cover.

This keeps a first render to the covers actually on screen. Client-side windowing of the grid itself
is deliberately not implemented: the filtering logic depends on the full in-memory list, and the
lazy images remove the dominant cost. Covers are requested at most 1000 px on the long edge;
Jellyfin scales them on the first request and caches the result.

## Authentication

There are two independent gates:

- **Jellyfin sign-in** (see [Jellyfin data layer](#jellyfin-data-layer)) controls access to media,
  artwork and funscripts. Users and their library access are managed in Jellyfin; the plugin only
  serves scripts of items the signed-in user can see.
- **HAPPY's own password** (`PASSWORD`) optionally guards the HAPPY page itself. It is a single
  shared password without user management, described below. Dropping it in favour of the Jellyfin
  sign-in alone is planned.

The logout button signs out of Jellyfin and, when `PASSWORD` is set, revokes HAPPY's token too.

### Password flow

1. `createApp()` mounts `/api/auth` and then `createAuthMiddleware()` **before** `express.static`,
   so `index.html`, `/js/app.js` and every `/api/*` route are unreachable without a token.
2. `POST /api/auth/login` compares the submitted password against `PASSWORD` in constant time,
   issues a 256-bit opaque token and returns it in an `HttpOnly`, `SameSite=Lax` cookie.
3. Subsequent requests to the HAPPY server are authorized by that cookie, which the browser
   sends with every asset request without any client code.
4. Rejected requests get `401 { error }`, or a `302` to `/auth/` for browser navigations.
   The client logs the failure to the console before redirecting.

### Token persistence

Tokens are appended to `tokens.txt` inside the config directory (default `/config/tokens.txt`, mode `0600`) as
`<token> <issued-at> <label>`. The file lives in the `/config` mount, so sessions survive
container restarts and rebuilds. The store re-reads the file whenever its mtime changes:
**deleting `/config/tokens.txt` revokes every session immediately, without a restart.**
Tokens do not expire on their own.

### Deployment modes

`TRUST_PROXY` is the number of reverse-proxy hops Express should trust:

- `0` (default) — direct LAN exposure over plain HTTP. `X-Forwarded-*` headers are ignored,
  the session cookie is issued without `Secure` (a `Secure` cookie would be dropped by the
  browser), and the login throttle keys on the real socket address.
- `1` — behind nginx/Traefik. `X-Forwarded-Proto: https` marks the cookie `Secure`, and
  `X-Forwarded-For` resolves the client IP.

### Files

- `src/server/middleware/auth.ts` — the guard, allow-list and cookie options
- `src/server/middleware/loginThrottle.ts` — in-process per-IP backoff on the login endpoint
- `src/server/services/tokenStore.ts` — issue/verify/revoke against the plain-text file
- `src/server/routes/auth.ts` — login, logout and status endpoints
- `public/auth/` — standalone login page, deliberately outside the bundle

Setting `PASSWORD` to an empty string disables the guard entirely.

## Device connection flow

Buttplug device management lives in `src/client/components/haptic/buttplugClient.ts`.

### Connection lifecycle

1. Client normalizes the Intiface WebSocket URL
2. `ButtplugClientManager.connect()` creates a browser websocket connector
3. On success:
   - connection state becomes `connected`
   - scanning starts
   - device-added/removed listeners refresh the UI
4. Feature assignments and per-device strengths are restored from `localStorage`
5. UI components (`DeviceStatus`, `DeviceAssignment`, haptic controls) react to state changes

### Channel and feature assignment model

- A **channel** (`src/shared/haptics.ts`) is one scriptable output: a `FunscriptType`
  plus an optional subcategory parsed from `<stem>.<type>.<sub>.funscript`, keyed as
  `estim` or `estim:nipples`. Files without a recognised type suffix become the
  `unknown` type, shown as "Generic"
- A **feature** is a single actuator of a device, identified by
  `<device name>#<scalar|rotate|linear>#<index>`
- Each feature is assigned to at most one channel, so one toy can run its vibrator
  and its rotator from two different scripts
- Several features (across devices) may share a channel
- Strength is set per device; there is no master strength
- Assignments and strengths persist locally in the browser
- A channel shows as disconnected while no connected feature is assigned to it

## Key technologies and libraries

- **Node.js 18+** runtime
- **Express** for HTTP API and static hosting
- **TypeScript** for client, server, and shared models
- **esbuild** for browser bundling
- **Video.js** for audio/video playback UI
- **Bootstrap 5** + **Bootstrap Icons** for layout/styling
- **Buttplug** browser client for Intiface connectivity
- **Jellyfin** for the library, metadata, artwork, trickplay, users and streaming; the HAPPY plugin is C# (.NET 10)

## Logging

`src/server/utils/logger.ts` is a process-wide, level-filtered wrapper around `console`. It is a
module-level singleton rather than an injected dependency because most server modules already log
while the configuration is still being assembled.

- Levels are `error < warn < info < debug`; `LOG_LEVEL` (YAML or environment) selects the threshold
- `Config.load()` applies `LOG_LEVEL` from the environment first, so config loading itself already
  honours the requested verbosity; an unknown name falls back to `info` with a warning
- Every line is prefixed with an ISO timestamp, the padded level, and the module tag
- `log.isDebug()` guards the loops that would otherwise build per-file strings that are then discarded

What each level covers:

| Level | Content |
| --- | --- |
| `error` | Unhandled request errors, failure to listen on the port |
| `warn` | Missing `JELLYFIN_URL`, read-only config mount, failed logins, throttled clients, authentication disabled |
| `info` | Listening address, first request of a client, login/logout, redirect to the login page |
| `debug` | Every HTTP request with status and duration, the effective configuration |

Connection logging lives in `src/server/middleware/requestLog.ts`. Logging every request at `info`
would drown the log in asset requests, so `info` is limited to a client (address + user agent)
that has not been seen for `CLIENT_IDLE_MS`. The same map is swept on that rare path to keep it
bounded.

## Directory structure

```text
config/                 Runtime settings and tokens (local stand-in for the /config volume)
jellyfin-plugin/        HAPPY plugin for Jellyfin (C#): funscript index and endpoints
public/                 Built client assets and vendored frontend libraries
scripts/                Build/helper scripts
src/
  client/               Browser application
    components/         Playback, haptic, visualization, and device UI modules
      player/           Session (two slots), queue, controller, footer element
    jellyfin/           Jellyfin session, sign-in card, library loader, mapper, URL builders
    utils/              Formatting and DOM helpers
    index.ts            Main SPA/controller
  server/               Express app, routes, config, auth and the DG-Lab relay
  shared/               Shared types and utility logic used by client/server
test/                   Unit tests (server, client) and opt-in Jellyfin integration tests
dist/                   Compiled server output
```

## Module organization notes

- `src/client/components/player/session.ts` owns the two Video.js player slots and their active/focus roles
- `src/client/components/player/queue.ts` holds queue order only; it never drives the session
- `src/client/components/player/controller.ts` joins session + queue + library and exposes browse/activate/step
- `src/client/components/player/footer.ts` is a `UIElement` bound to the active slot's store via `StoreController`
- `src/client/components/funscriptSync.ts` isolates playback-time → device-command logic
- `src/client/components/haptic/buttplugClient.ts` isolates Intiface connection and command routing
- `src/client/index.ts` coordinates navigation, player ownership, footer state, and UI wiring
- `src/client/router.ts` maps the query string onto views; `components/library/detail.ts` renders playlist/album pages
- `src/client/components/settings/` and `components/haptic/dglab/pairingPanel.ts` wire the settings panel
- `src/client/components/haptic/featureSettings.ts` and `emitter.ts` hold the per-backend assignment/strength storage and listener lists shared by both backends
- `src/server/routes/` keeps each API concern separate
- `src/client/api.ts` is the single data facade; `src/client/jellyfin/connection.ts` owns the Jellyfin session, `library.ts` the requests, `mapper.ts` the pure DTO → `LibraryResponse` mapping and `urls.ts` the stream, image and trickplay URLs
- `src/shared/albums.ts` and `src/shared/funscriptNames.ts` hold album grouping and funscript name/chapter parsing
- `src/server/utils/logger.ts` owns the log level; every server module logs through `createLogger('[tag]')` instead of `console`
- `src/shared/types.ts` provides the shared contracts: the client's library model and the `/api/config` payload

## Documentation

- User docs live in `docs/*.md` and are served in-app at `/docs/<page>`. When a change affects user-facing behavior, settings or setup, update the matching page in the same change.
- Keep `README.md` a minimal quick start (Intiface basics, Docker Compose, library layout) that links to `docs/`. Do not move details back into it.
- Link between docs with relative paths (`library.md#funscripts`, `screenshots/x.jpg`) so they work on GitHub and in the app. Page names must match `[a-z0-9-]+`.
- Developer docs live in `docs/developer/`. They use Mermaid diagrams, are excluded from the Docker image (`.dockerignore`) and are not served in-app. Update them when a change moves responsibilities between modules; each page ends with a code map listing the files it describes.