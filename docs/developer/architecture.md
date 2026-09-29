[← Developer Guide](README.md)

# Architecture overview

HAPPY is one Node.js process that serves a single-page app. The server indexes and streams media. **Everything that happens in real time runs in the browser**: playback, funscript interpolation and device output. The server never talks to a toy.

## System context

Which processes exist and who opens which connection.

```mermaid
flowchart LR
  subgraph userDevices["User devices"]
    Browser["Browser tab<br/>HAPPY single-page app"]
    Intiface["Intiface Central<br/>WebSocket server, default port 12345"]
    Toys["Bluetooth / USB toys"]
    DGApp["DG-Lab app<br/>on a phone"]
    Coyote["DG-Lab Coyote 3.0"]
  end

  subgraph container["HAPPY container (Node.js)"]
    Express["Express app<br/>HTTP /api/*, static files"]
    Relay["DG-Lab relay<br/>WebSocket /ws/dglab<br/>only if DGLAB_ENABLED"]
  end

  MediaVol[("/media<br/>audio, video, .funscript,<br/>.md, .m3u")]
  ConfigVol[("/config<br/>settings.yaml, tokens.txt,<br/>cache/")]
  FF["ffprobe / ffmpeg<br/>child processes"]

  Browser -- "HTTP: UI, library, media, funscripts" --> Express
  Browser -- "WebSocket: Buttplug protocol" --> Intiface
  Intiface -- "BLE / USB" --> Toys
  Browser -- "WebSocket: controller" --> Relay
  DGApp -- "WebSocket: app, ?tid=" --> Relay
  DGApp -- BLE --> Coyote
  Express --> MediaVol
  Express --> ConfigVol
  Express --> FF
```

Key points:

- The browser connects to **Intiface directly**. The server is not involved, so the Intiface address must be reachable from the browser's device, not from the container.
- The DG-Lab app cannot reach a browser tab, so the server hosts a small **relay**. Both the browser tab and the app connect to it, and the relay forwards messages between them without interpreting them. See [Pair a DG-Lab Coyote](use-cases/coyote-pairing.md).
- `/config/cache` only holds derived data (library index, extracted covers). It is safe to delete.

## Code layers

`src/` is split into three layers. `shared/` holds types and pure logic that both sides import. The client and server never import from each other.

```mermaid
flowchart TB
  subgraph client["src/client (browser, bundled by esbuild)"]
    AppIndex["index.ts<br/>App: wiring, routing, views"]
    Login["login.ts<br/>login page"]
    Player["components/player<br/>PlaybackSession, PlaybackQueue,<br/>PlaybackController, footer"]
    LibraryUI["components/library<br/>Library grid, filters, tags"]
    Haptic["components/haptic<br/>backends, device UI, visualization"]
    Sync["components/funscriptSync.ts<br/>FunscriptSync"]
    Utils["utils/<br/>api, routes, html, formatting"]
  end

  subgraph videojs["@/components/videojs"]
    VJS["video-player element,<br/>skins, loop/skip/repeat/chapters"]
  end

  subgraph shared["src/shared (pure, no DOM, no Node APIs)"]
    Types["types.ts"]
    HapticsShared["haptics.ts<br/>HapticChannel, channelKey"]
    Interp["interpolation.ts<br/>prepareScript, positionAt"]
    Chapters["chapters.ts"]
    Filtering["libraryFiltering.ts"]
  end

  subgraph server["src/server (Node.js, compiled by tsc)"]
    ServerIndex["index.ts<br/>createApp, main"]
    Middleware["middleware/<br/>auth, loginThrottle, requestLog"]
    Routes["routes/<br/>one router per /api prefix"]
    Services["services/<br/>libraryIndex, libraryService,<br/>mediaProbe, artworkCache,<br/>tokenStore, dglabRelay"]
    SUtils["utils/<br/>paths, mediaFiles, logger, errors"]
  end

  AppIndex --> Player & LibraryUI & Haptic & Sync & Utils
  Player --> VJS
  Sync --> Interp
  Haptic --> Interp & HapticsShared
  LibraryUI --> Filtering
  ServerIndex --> Middleware & Routes
  Routes --> Services & SUtils
  Services --> Chapters & Types
  client -. "types only" .-> Types
```

## Runtime responsibilities

| Concern | Where it runs | Main module |
| --- | --- | --- |
| Scan media folder, read tags, chapters | Server | `libraryService.buildLibrary()` behind `libraryIndex` |
| Cache the library across restarts | Server | `libraryIndex` → `/config/cache/library.json` |
| Extract cover art | Server | `routes/artwork.ts` + `artworkCache` |
| Stream media with range requests | Server | `routes/media.ts` |
| Serve raw funscript JSON | Server | `routes/funscript.ts` |
| Password login, tokens | Server | `middleware/auth.ts`, `routes/auth.ts`, `tokenStore` |
| Relay DG-Lab messages | Server | `services/dglabRelay.ts` |
| Routing, views, library grid | Browser | `App` in `client/index.ts`, `Library` |
| Playback with two players | Browser | `PlaybackSession`, `PlaybackController` |
| Funscript interpolation | Browser | `shared/interpolation.ts` |
| Timing loop that drives devices | Browser | `FunscriptSync` (one per backend) |
| Talking to Intiface | Browser | `ButtplugClientManager` |
| Talking to the DG-Lab app | Browser | `CoyoteBackend` → `DglabV4Socket` |

## Build and deployment

```mermaid
flowchart LR
  subgraph sources["Sources"]
    SC["src/client/**"]
    SS["src/server/** + src/shared/**"]
    SCSS["public/css/*.scss"]
    NM["node_modules<br/>bootstrap, icons, videojs"]
    Docs["docs/*.md"]
    DevDocs["docs/developer/**"]
  end

  SC -- "esbuild<br/>scripts/build-client.js" --> JS["public/js/app.js<br/>public/auth/login.js"]
  SS -- "tsc<br/>tsconfig.server.json" --> Dist["dist/server, dist/shared"]
  SCSS -- sass --> CSS["public/css/app.css<br/>public/auth/auth.css"]
  NM -- "scripts/copy-vendor-assets.js" --> Vendor["public/vendor/**"]

  JS & CSS & Vendor --> Image[["Docker runtime image"]]
  Dist --> Image
  Docs --> Image
  DevDocs -. "excluded by .dockerignore" .-x Image
```

| Command | What it does |
| --- | --- |
| `npm run build` | `build:server` (tsc) → `build:client` (sass + esbuild) → `build:vendor` |
| `npm run dev:client` | esbuild in watch mode with source maps |
| `npm start` | `node dist/server/index.js` |
| `npm test` | `node --test` with `tsx` over `test/server` and `test/client` |
| `npm run docs:env` | Regenerates the environment variable table in `docs/configuration.md` |

## Code map

| Diagram | Based on |
| --- | --- |
| System context | [src/server/index.ts](../../src/server/index.ts), [src/server/services/dglabRelay.ts](../../src/server/services/dglabRelay.ts), [src/client/components/haptic/buttplugClient.ts](../../src/client/components/haptic/buttplugClient.ts) |
| Code layers | `src/client`, `src/shared`, `src/server`, [@/components/videojs](../../@/components/videojs/player.ts) |
| Build | [package.json](../../package.json), [scripts/build-client.js](../../scripts/build-client.js), [Dockerfile](../../Dockerfile), [.dockerignore](../../.dockerignore) |
