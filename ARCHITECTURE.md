# Architecture

## Overview

This is a TypeScript application split into two clear runtime layers:

- **Server (`src/server/`)**: scans media, parses metadata, serves static assets, and exposes JSON/media endpoints.
- **Client (`src/client/`)**: renders the Bootstrap UI, manages routing, playback, haptic synchronization, and device control in the browser.

The server is intentionally stateless with respect to playback. All live playback, footer state, haptic timing, and Intiface device connection state live in the browser.

The one carve-out is the optional **DG-Lab V4 relay** (`/ws/dglab`). A browser cannot accept
WebSocket connections, so pairing a phone-hosted DG-Lab app with the player needs a meeting
point. The relay is a dumb passthrough: it pairs one controller with one or more apps and
forwards opaque payloads. It never parses a device command, so all haptic logic still lives in
the browser and all safety limits still live in the DG-Lab app.

A controller's id is derived from its access token rather than being random, so the pairing URL
survives reloads. Its slot also outlives its socket by a grace period: switching to the DG-Lab
app backgrounds the browser and mobile Chrome may close the WebSocket, so the relay holds the
slot, accepts the app that arrives meanwhile, and hands it to the tab when it returns.

## High-level system architecture

### Server responsibilities

- Load runtime configuration from `config/settings.yaml`
- Build the media library model from the filesystem and cache it in `<configDir>/cache/`
- Expose API routes for:
  - `/api/library`, `POST /api/library/refresh`
  - `/api/media/:trackId`
  - `/api/artwork/:trackId`
  - `/api/funscript/:trackId/:filename`
  - `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`
  - `/api/config` (the client-visible half of the configuration only)
  - `/ws/dglab` (WebSocket relay, only when `DGLAB_ENABLED` is on)
- Serve compiled frontend assets from `public/`
- Gate every asset and API route behind a valid access token
- Write a level-filtered log of startup, connection, and authentication events to the docker console

### Client responsibilities

- Fetch library/config data from the server
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

`HapticBackendRegistry` implements the same interface by fanning out across both, so one
funscript can drive an Intiface toy and a Coyote simultaneously. `FunscriptSync` only ever
sees the registry.

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

1. Client fetches library/config from API utilities in `src/client/utils/api.ts`
2. Router state determines whether library/detail/player view is shown
3. Opening a file:
   - updates `currentTrackId`
   - `PlaybackSession.browse()` points the focus at the active slot when the ids
     match, otherwise loads the track into the idle slot
   - loads funscripts/description for the browsed file
4. Starting playback:
   - the focused slot promotes itself to active
   - footer and Media Session metadata follow via `PlaybackController.onActiveTrack`
   - scripts are loaded into the haptic sync engine
5. Footer visibility follows `PlaybackSession.activeRequest`; page-player
   visibility follows the focus index

## Haptic sync lifecycle

The haptic pipeline is:

1. user opens a track
2. client fetches matching funscripts
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

## Library indexing and caching

Scanning the media directory is the single most expensive thing the server does: `buildLibrary()`
runs `music-metadata` over every audio and video file, and extracting a cover means parsing the
container of a file that may be several gigabytes. Neither cost may be paid per request once a
library grows past a few hundred items, so both results are cached.

Everything derived lives under the `cache/` subdirectory of the `/config` mount. It contains only
reproducible data and is safe to delete at any time — the next request rebuilds it:

```text
<configDir>/
  settings.yaml        hand-edited configuration
  tokens.txt           issued access tokens
  cache/
    library.json       library index snapshot
    artwork/           extracted cover images, two files per entry
```

All cache writes are best effort. A read-only or full `/config` mount logs a warning and degrades to
an in-memory-only cache rather than failing the request.

### Library index

`src/server/services/libraryIndex.ts` wraps `buildLibrary()` with an in-memory snapshot that is
mirrored to `cache/library.json`, so a restart does not re-scan an unchanged library.

Staleness is decided by a **fingerprint**, not by a timer:

- `computeMediaFingerprint()` walks the media directory and hashes `path`, `size` and `mtimeMs` of
  every file. This is one `stat` per file and no metadata parsing, i.e. orders of magnitude cheaper
  than a rebuild.
- The config values that influence the scan result (media directory, `ignoreExt`, all funscript
  suffixes) are hashed into the same digest, so editing `settings.yaml` invalidates the snapshot.

`get()` revalidates the fingerprint at most once every 30 seconds; within that window it answers
straight from memory. A rebuild is triggered only when the digest actually differs. Concurrent
callers share a single in-flight build promise, so a burst of requests can never start two scans.

`CACHE_FORMAT_VERSION` guards the on-disk shape: bump it whenever `LibraryResponse` changes, and
older snapshots are discarded instead of being trusted. The file is written via a temp file plus
rename so a crash mid-write cannot leave a half-parsed snapshot behind.

`createApp()` kicks off the first `get()` eagerly, which moves the startup scan off the first
visitor's request. `POST /api/library/refresh` forces a rebuild regardless of the fingerprint; it is
the escape hatch for media added over a network share whose mtimes do not reflect the change.

### Artwork cache

`src/server/services/artworkCache.ts` stores each extracted cover under `cache/artwork/` as two
files, so a cache hit never needs a directory scan:

- `<key>.meta` — JSON `{ "mime": "image/jpeg" }`
- `<key>.bin` — the raw image bytes

The key is `sha1(trackId + ':' + artworkVersion)`, where `artworkVersion` is the media file's mtime
in whole milliseconds. Re-tagging a file changes its mtime and therefore its key, which invalidates
every cached copy of that cover without any explicit invalidation step.

Files **without** a cover are cached too, as a negative entry (`{ "mime": null }`). Without this,
every art-less track would re-parse its full media file on each request just to produce a 404.

Stale entries are removed after every successful library rebuild: the index hands the cache the set
of keys referenced by the fresh snapshot, and `prune()` deletes everything else.

### HTTP caching of `/api/artwork/:id`

- The route always sends an `ETag` derived from the cache key, and answers a matching
  `If-None-Match` with `304` before touching the cache or the media file.
- `?v=<artworkVersion>` marks the response `public, max-age=31536000, immutable`, so repeat visits
  skip the request entirely. The client appends this automatically via `artworkUrl()`.
- Unversioned URLs fall back to `public, max-age=86400, must-revalidate`, where the ETag turns a
  revalidation into a `304` instead of a re-send.

`TrackInfo.artworkVersion` carries the mtime to the browser purely so the client can build those
versioned URLs.

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
  art-less media costs no round trip at all. Album covers point at `coverTrackId`, which the server
  leaves `null` when no track in the album carries a cover.

This keeps a first render to the covers actually on screen. Client-side windowing of the grid itself
is deliberately not implemented: the filtering logic depends on the full in-memory list, and the
lazy images remove the dominant cost. Downscaling covers to thumbnail size server-side would cut
bandwidth further, but needs a native image library (`sharp`) and is left out to keep the runtime
image lean.

## Authentication

A single shared password guards the whole application. There is no user management.

### Flow

1. `createApp()` mounts `/api/auth` and then `createAuthMiddleware()` **before** `express.static`,
   so `index.html`, `/js/app.js` and every `/api/*` route are unreachable without a token.
2. `POST /api/auth/login` compares the submitted password against `PASSWORD` in constant time,
   issues a 256-bit opaque token and returns it in an `HttpOnly`, `SameSite=Lax` cookie.
3. Subsequent requests are authorized by that cookie. A cookie is required rather than an
   `Authorization` header because artwork and media are loaded through `<img src>` and
   `<video src>`, which cannot send custom headers.
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
- **music-metadata** for server-side metadata extraction

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
| `error` | Unhandled request errors, failed initial library scan |
| `warn` | Missing media directory, read-only config mount, failed logins, throttled clients, authentication disabled |
| `info` | Listening address, library scan summary (counts per category, funscripts, ignored files), first request of a client, login/logout, redirect to the login page |
| `debug` | One line per media file and per ignored file, every HTTP request with status and duration, cache hits and rebuilds |

The startup summary is produced by `logLibrarySummary()` in `libraryService.ts` and is emitted by
`createApp()` once the first `libraryIndex.get()` resolves. It walks the media directory itself
(stat only, no metadata parsing), so the summary is identical whether the library was freshly
scanned or restored from `cache/library.json`.

Connection logging lives in `src/server/middleware/requestLog.ts`. Logging every request at `info`
would drown the log in artwork requests, so `info` is limited to a client (address + user agent)
that has not been seen for `CLIENT_IDLE_MS`. The same map is swept on that rare path to keep it
bounded.

## Directory structure

```text
config/                 Runtime settings, tokens, and the derived cache/ subdirectory
public/                 Built client assets and vendored frontend libraries
scripts/                Build/helper scripts
src/
  client/               Browser application
    components/         Playback, haptic, visualization, and device UI modules
      player/           Session (two slots), queue, controller, footer element
    utils/              API and formatting helpers
    index.ts            Main SPA/controller
  server/               Express app, routes, config, and library services
  shared/               Shared types and utility logic used by client/server
test/                   Existing tests
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
- `src/server/routes/` keeps each API concern separate
- `src/server/services/libraryService.ts` performs the raw filesystem scan; it holds no state
- `src/server/services/libraryIndex.ts` owns caching and staleness detection around that scan
- `src/server/services/artworkCache.ts` owns the on-disk cover cache, including negative entries
- `src/server/utils/logger.ts` owns the log level; every server module logs through `createLogger('[tag]')` instead of `console`
- `src/shared/types.ts` provides shared contracts between server responses and client consumers

## Documentation

- User docs live in `docs/*.md` and are served in-app at `/docs/<page>`. When a change affects user-facing behavior, settings or setup, update the matching page in the same change.
- Keep `README.md` a minimal quick start (Intiface basics, Docker Compose, library layout) that links to `docs/`. Do not move details back into it.
- Link between docs with relative paths (`library.md#funscripts`, `screenshots/x.jpg`) so they work on GitHub and in the app. Page names must match `[a-z0-9-]+`.