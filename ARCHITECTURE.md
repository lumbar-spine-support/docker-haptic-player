# Architecture

## Overview

This is a TypeScript application split into two clear runtime layers:

- **Server (`src/server/`)**: scans media, parses metadata, serves static assets, and exposes JSON/media endpoints.
- **Client (`src/client/`)**: renders the Bootstrap UI, manages routing, playback, haptic synchronization, and device control in the browser.

The server is intentionally stateless with respect to playback. All live playback, footer state, haptic timing, and Intiface device connection state live in the browser.

## High-level system architecture

### Server responsibilities

- Load runtime configuration from `config/settings.yaml`
- Build the media library model from the filesystem
- Expose API routes for:
  - `/api/library`
  - `/api/media/:trackId`
  - `/api/artwork/:trackId`
  - `/api/funscript/:trackId/:filename`
  - `/api/config`
- Serve compiled frontend assets from `public/`

### Client responsibilities

- Fetch library/config data from the server
- Render library, album, playlist, and file views
- Maintain the **two-player model**
- Keep the persistent footer in sync with the active playback player
- Drive haptic output through Buttplug/Intiface
- Manage local UI preferences in `localStorage`

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

## Device connection flow

Buttplug device management lives in `src/client/components/buttplugClient.ts`.

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
  `estim` or `estim:nipples`
- A **feature** is a single actuator of a device, identified by
  `<device name>#<scalar|rotate|linear>#<index>`
- Each feature is assigned to at most one channel, so one toy can run its vibrator
  and its rotator from two different scripts
- Several features (across devices) may share a channel
- Strength is multiplied per device on top of the master strength
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

## Directory structure

```text
config/                 Runtime settings
public/                 Built client assets and vendored frontend libraries
scripts/                Build/helper scripts
src/
  client/               Browser application
    components/         Playback, haptic, visualization, and device UI modules
      player/           Session (two slots), queue, controller, footer element
    utils/              API and formatting helpers
    index.ts            Main SPA/controller
    player.ts           URL/base-path bootstrap redirect
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
- `src/client/components/buttplugClient.ts` isolates Intiface connection and command routing
- `src/client/index.ts` coordinates navigation, player ownership, footer state, and UI wiring
- `src/server/routes/` keeps each API concern separate
- `src/shared/types.ts` provides shared contracts between server responses and client consumers
