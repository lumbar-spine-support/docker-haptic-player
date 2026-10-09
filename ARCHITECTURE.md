# Architecture

> Diagrams and step-by-step use cases (pairing, playback, library load, login) live in [docs/developer/](docs/developer/README.md).

## Overview

HAPPY is a TypeScript browser application that runs inside a Jellyfin server. There is no HAPPY server of its own:

- **Client (`src/client/`)**: signs in to Jellyfin, builds the library model from Jellyfin's API, and renders the Bootstrap UI, routing, playback, haptic synchronization and device control in the browser.
- **Jellyfin + the HAPPY plugin (`jellyfin-plugin/`, C#)**: Jellyfin owns scanning, metadata, artwork, chapters, trickplay thumbnails, users and streaming. The plugin serves the built client (`/Happy/Web/`), the client settings (`/Happy/Config`), the version (`/Happy/Info`), the user docs (`/Happy/Docs`) and the one thing Jellyfin does not know: funscripts next to the media files.
- **DG-Lab relay (`dglab-relay/`)**: an optional, separate Docker image, needed only for the DG-Lab Coyote (below).

The plugin is intentionally stateless with respect to playback. All live playback, footer state, haptic timing, and Intiface device connection state live in the browser.

Media always plays **directly** (`/Videos|Audio/{id}/stream?static=true`), never transcoded: haptic
timing follows the media element's own clock, and VR needs the full-resolution frame. Chromecast and
other remote playback receivers fetch that URL themselves; the Jellyfin access token travels in its
`ApiKey` query parameter, so no separate media token is needed.

The one carve-out is the optional **DG-Lab V4 relay** (`dglab-relay/`). A browser cannot accept
WebSocket connections, so pairing a phone-hosted DG-Lab app with the player needs a meeting
point. The relay is a dumb passthrough: it pairs one controller with one app and
forwards opaque payloads. It never parses a device command, so all haptic logic still lives in
the browser and all safety limits still live in the DG-Lab app.

The relay is its own image and release-please component (tags `dglab-relay-v*`), so only Coyote
owners run it and HAPPY releases do not rebuild it. HAPPY is single-user, so the relay has exactly
one controller slot with a random id created at startup. Any tab signed in to Jellyfin that connects takes the slot (the previous one is closed as
`replaced`), so the pairing URL survives reloads and switching devices. The slot also outlives
its socket by a grace period: switching to the DG-Lab app backgrounds the browser and mobile
Chrome may close the WebSocket, so the relay keeps the app, accepts one that arrives meanwhile,
and hands it to the tab when it returns. A newly connecting app likewise replaces the previous one.

## High-level system architecture

### Plugin responsibilities

- Serve the built client from `public/`, embedded in the DLL, at `/Happy/Web/` (anonymous, so the page can show the sign-in card)
- Serve the user docs from `docs/*.md`, embedded in the DLL, at `/Happy/Docs` (anonymous)
- Serve the client settings (`/Happy/Config`) and the version (`/Happy/Info`) to signed-in users
- Let admins edit the client settings on its dashboard page
- Index funscripts next to the media and serve them only for items the signed-in user can see
- List HAPPY in Jellyfin's web client by adding a `menuLinks` entry to `/web/config.json` (`Web/WebConfigStartupFilter.cs`)

### Jellyfin web client integration

**HAPPY injects no JavaScript into Jellyfin's web client (jellyfin-web).** Integration is limited to:

- **Data jellyfin-web already understands.** The plugin adds a link to the `menuLinks` of `/web/config.json`, which jellyfin-web renders for every user.
- **The shared origin.** HAPPY adopts jellyfin-web's stored sign-in (`jellyfin_credentials`).

Playback, haptics and VR stay in HAPPY's own player. VR180 (inline and WebXR) is a hard requirement, and it lives in HAPPY's Video.js player. Jellyfin's player can only be reached through private jellyfin-web internals that change between releases, and Jellyfin's native apps never run injected code. Item-page buttons or haptics in Jellyfin's player would need such injection and are deliberately not done.

### DG-Lab relay responsibilities

- Accept WebSocket connections on any path ending in `/ws/dglab`
- Verify the Jellyfin token of HAPPY tabs on upgrade (`GET /Users/Me` on its `JELLYFIN_URL`)
- Pair one controller with one DG-Lab app and forward their messages
- Write a level-filtered log to the docker console (`LOG_LEVEL`)

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

1. Client signs in, then fetches the settings from the plugin and the library from Jellyfin, both through `src/client/api.ts`
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
access token, user id and user name in `localStorage`, keyed to the server address. That address
comes from the page's own URL: `jellyfinUrlFromPage()` (`serverUrl.ts`) takes everything before
`/Happy/Web/`, so a Jellyfin base URL such as `/jellyfin` is kept.
API requests send it in a `MediaBrowser … Token="…"` authorization header. A stable per-browser
`DeviceId` keeps Jellyfin's device list to one entry per browser. A `401` forgets the session and
reloads, which shows the sign-in card (`signIn.ts`) again. A page not served from `/Happy/Web/`
shows a notice instead of loading. The `DeviceId` comes from `crypto.getRandomValues`, because
`crypto.randomUUID` is missing on plain-HTTP LAN origins, where Jellyfin often runs.

The plugin's settings (`GET /Happy/Config`) need a signed-in user, so `init()` signs in first and
only then fetches the settings, the version (`/Happy/Info`) and, on demand, the docs (`/Happy/Docs`).

Media elements cannot send headers, so stream and trickplay sheet URLs carry the token as
`ApiKey` (Jellyfin 12 ignores the legacy `api_key`). Images (`/Items/{id}/Images/Primary`) need no token.

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
  (`src/shared/funscriptNames.ts`, honouring the configured `funscriptSuffixes`)
- embedded chapters come from Jellyfin; funscript `metadata.chapters` are only known once the
  scripts load, and replace them according to the configured `chapterSourcePriority`
  (`PlaybackSession.updateChapters()` swaps the chapter track without reloading the media)
- trickplay uses the resolution closest to 320 px
- favorites are Jellyfin's per-user `UserData.IsFavorite` (requested with `EnableUserData=true`) on
  tracks, videos and playlists; client-side albums have none. HAPPY writes them back with
  `POST`/`DELETE /UserFavoriteItems/{id}` (`setFavorite()`), optimistically, and they are the only
  thing the client writes to Jellyfin's library data

### Generated WebVTT and origins

Video.js reads chapters and timeline thumbnails from `<track>` elements. The client builds both
files itself (`buildChaptersVtt()`, `trickplayVtt()`) and hands them over as `blob:` URLs, which are
same-origin and need no CORS. The storyboard cues point at Jellyfin's trickplay sheets with `#xywh=`
fragments.

The plugin serves HAPPY from Jellyfin's own origin, so media, images and API calls are
same-origin. Both `<video>` elements and the images drawn into the playlist collage still use
`crossorigin="anonymous"`, which costs nothing there: the WebGL VR projection and
`canvas.toDataURL()` need untainted frames, and Jellyfin answers CORS requests with
`Access-Control-Allow-Origin: *`. No cookies are involved.

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

Jellyfin is the only account system. The in-app Jellyfin sign-in card (see
[Jellyfin data layer](#jellyfin-data-layer)) is the one sign-in; users and their library access are
managed in Jellyfin, and the plugin only serves scripts of items the signed-in user can see.
HAPPY keeps no passwords, tokens or cookies of its own.

- The plugin serves the app (`/Happy/Web/`) and the docs (`/Happy/Docs`) without authentication,
  so the page can show the sign-in card. They hold no media. The settings, the version, the
  funscripts and everything else from Jellyfin need the token.
- Without its own session, HAPPY first adopts the sign-in of Jellyfin's web client from the
  shared origin's `localStorage` (`jellyfin_credentials`), checked with `GET /Users/Me`. Such a
  session is marked *borrowed*.
- The logout button (shown whenever there is a Jellyfin session) calls `POST /Sessions/Logout`
  and reloads the page, which shows the sign-in card again. For a borrowed session it only forgets
  it and returns to `../../web/` ("Leave HAPPY"): logging out would end the web client's session too.
- A Jellyfin `401` on any client request drops the stored session and reloads into the sign-in card.

### DG-Lab relay

The relay (`dglab-relay/src/server.ts`) authenticates WebSocket upgrades itself:

1. Browsers cannot set headers on a WebSocket, so a HAPPY tab offers its Jellyfin token as a
   subprotocol: `new WebSocket(url, ['happy', 'jellyfin.<token>'])` (`DGLAB_PROTOCOL`,
   `DGLAB_AUTH_PROTOCOL_PREFIX` in `src/shared/dglab.ts`). The token never appears in a URL or a log.
2. The relay reads it from `Sec-WebSocket-Protocol` and checks it with `GET /Users/Me` on its
   `JELLYFIN_URL` (`dglab-relay/src/jellyfinAuth.ts`). Valid tokens are cached for 60 s and
   rejections for 5 s; an unreachable Jellyfin (5 s timeout) is not cached. Anything else is
   refused with `401`.
3. The relay selects `happy`, so the token is never echoed in the handshake.
4. DG-Lab apps connect with `?tid=` and no token; the unguessable `tid` is their credential.

`initDglab()` runs after the Jellyfin sign-in so the relay's auto-reconnect already has a token.

The client dials the `dglabRelayUrl` setting with `/ws/dglab` appended (`relayEndpoint()` in
`components/haptic/dglab/coyoteBackend.ts`). Empty means `/ws/dglab` on the page's own origin, for
a reverse proxy that forwards that path to the relay. The pairing URL for the app
(`relayPairingUrl()`) uses the relay's host unless it is a loopback address, and the per-user
pairing-host override wins over both. See [dglab-relay/README.md](dglab-relay/README.md).

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

- **Jellyfin plugin** (C#, .NET 10) for serving the app, settings, docs and funscripts
- **Node.js** with **ws** for the optional DG-Lab relay
- **TypeScript** for the client, the relay and shared models
- **esbuild** for browser bundling
- **Video.js** for audio/video playback UI
- **Bootstrap 5** + **Bootstrap Icons** for layout/styling
- **Buttplug** browser client for Intiface connectivity
- **Jellyfin** for the library, metadata, artwork, trickplay, users and streaming

## Logging

- **Client:** modules log through `createLogger(namespace)` (`src/client/utils/logger.ts`); levels
  are set per namespace with `setLogLevel()` or the `localStorage['happy-log']` override. The plugin
  setting *Debug output in the browser console* (`debugLogging`) turns on `dglab=debug`.
- **Plugin:** logs through Jellyfin's `ILogger`, so its lines end up in Jellyfin's log.
- **Relay:** `dglab-relay/src/logger.ts` is a level-filtered wrapper around `console` (`LOG_LEVEL`,
  `error < warn < info < debug`). `error` covers a missing `JELLYFIN_URL`, `warn` Jellyfin errors
  while verifying a token, `info` the listening address and `debug` controller and app connections.

## Directory structure

```text
config/                 Local test and dev Jellyfin credentials (not committed)
dev/jellyfin/           Compose file for the local dev Jellyfin
dglab-relay/            DG-Lab relay (Node, ws), its own Docker image
jellyfin-plugin/        HAPPY plugin for Jellyfin (C#): web app, settings, docs, funscript index and endpoints
public/                 Client shell, SCSS, icons; built client assets and vendored frontend libraries
scripts/                Build/helper scripts
src/
  client/               Browser application
    components/         Playback, haptic, visualization, and device UI modules
      player/           Session (two slots), queue, controller, footer element
    jellyfin/           Jellyfin session, sign-in card, library loader, mapper, URL builders
    utils/              Formatting and DOM helpers
    index.ts            Main SPA/controller
  shared/               Shared types and pure logic (the relay imports dglab.ts)
test/                   Unit tests (client, scripts) and opt-in Jellyfin integration tests
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
- `src/client/api.ts` is the single data facade; `src/client/jellyfin/connection.ts` owns the Jellyfin session, `library.ts` the requests, `mapper.ts` the pure DTO → `LibraryResponse` mapping and `urls.ts` the stream, image and trickplay URLs
- `src/shared/albums.ts` and `src/shared/funscriptNames.ts` hold album grouping and funscript name/chapter parsing
- `src/shared/types.ts` provides the shared contracts: the client's library model and the `/Happy/Config` payload (`ClientSettings`, mirrored by the plugin's `Configuration/ClientSettings.cs`)
- `jellyfin-plugin/Jellyfin.Plugin.Happy/Api/` holds the plugin's controllers: `HappyController` (config, info, funscripts), `WebController` (the app) and `DocsController` (the docs)

## Documentation

- User docs live in `docs/*.md`, are embedded in the plugin (`/Happy/Docs/<page>`) and are shown in-app at `?view=docs&id=<page>`. When a change affects user-facing behavior, settings or setup, update the matching page in the same change.
- Keep `README.md` a minimal quick start (plugin install, library layout, Intiface basics, optional relay) that links to `docs/`. Do not move details back into it.
- Link between docs with relative paths (`library.md#funscripts`, `screenshots/x.jpg`) so they work on GitHub and in the app. Page names must match `[a-z0-9-]+`.
- Developer docs live in `docs/developer/`. They use Mermaid diagrams and are neither embedded in the plugin nor served in-app. Update them when a change moves responsibilities between modules; each page ends with a code map listing the files it describes.