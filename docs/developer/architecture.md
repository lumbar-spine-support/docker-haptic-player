[← Developer Guide](README.md)

# Architecture overview

HAPPY is a single-page app that runs inside a Jellyfin server. The HAPPY plugin serves the app at `<jellyfin>/Happy/Web/`, together with its settings, version, docs and the funscripts; Jellyfin owns the media library and streams it. There is no HAPPY server of its own. The only separate process is the optional DG-Lab relay, for Coyote owners. **Everything that happens in real time runs in the browser**: playback, funscript interpolation and device output. Neither Jellyfin nor the relay ever talks to a toy.

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

  subgraph jellyfin["Jellyfin server"]
    JF["Jellyfin API<br/>items, streams, images,<br/>chapters, trickplay, users"]
    Plugin["HAPPY plugin<br/>/Happy/Web, /Happy/Config,<br/>/Happy/Info, /Happy/Docs,<br/>/Happy/Funscripts"]
    PluginConfig[("plugin configuration<br/>XML, edited on the dashboard")]
  end

  subgraph relayContainer["DG-Lab relay container (optional)"]
    Relay["DG-Lab relay<br/>WebSocket …/ws/dglab"]
  end

  MediaVol[("Jellyfin libraries<br/>audio, video, .funscript")]

  Browser -- "HTTP: app, settings, docs,<br/>funscripts" --> Plugin
  Browser -- "HTTP: library, streams,<br/>art, trickplay" --> JF
  Browser -- "WebSocket: Buttplug protocol" --> Intiface
  Intiface -- "BLE / USB" --> Toys
  Browser -- "WebSocket: controller,<br/>subprotocol jellyfin.TOKEN" --> Relay
  Relay -- "GET /Users/Me" --> JF
  DGApp -- "WebSocket: app, ?tid=" --> Relay
  DGApp -- BLE --> Coyote
  Plugin --> PluginConfig
  JF --> MediaVol
  Plugin --> MediaVol
```

Key points:

- The browser connects to **Intiface directly**. Jellyfin is not involved, so the Intiface address must be reachable from the browser's device, not from the Jellyfin server.
- The page comes from Jellyfin itself, so the app, the Jellyfin API, streams and images share one origin. The client derives Jellyfin's address from its own URL (see [client.md](client.md#jellyfin-data-layer)); there is nothing to configure.
- The DG-Lab app cannot reach a browser tab, so both connect to a small **relay**, which forwards messages between them without interpreting them. It is its own Docker image ([dglab-relay/README.md](../../dglab-relay/README.md)); the browser finds it through the `dglabRelayUrl` setting. See [Pair a DG-Lab Coyote](use-cases/coyote-pairing.md).
- The [HAPPY plugin](jellyfin-plugin.md) is the only HAPPY code inside Jellyfin.

## Code layers

`src/` is split into two layers. `shared/` holds types and pure logic; the client imports it, and so does the relay (`dglab.ts` only). The plugin is C# and shares only the JSON shapes (`ClientSettings` in `types.ts` ↔ `Configuration/ClientSettings.cs`).

```mermaid
flowchart TB
  subgraph client["src/client (browser, bundled by esbuild)"]
    AppIndex["index.ts<br/>App: wiring, routing, views"]
    Player["components/player<br/>PlaybackSession, PlaybackQueue,<br/>PlaybackController, footer"]
    LibraryUI["components/library<br/>Library grid, filters, tags"]
    Haptic["components/haptic<br/>backends, device UI, visualization"]
    Sync["components/funscriptSync.ts<br/>FunscriptSync"]
    JellyfinC["jellyfin/ + api.ts<br/>session, sign-in, loader,<br/>mapper, URL builders"]
    Utils["utils/<br/>routes, html, formatting"]
  end

  subgraph videojs["@/components/videojs"]
    VJS["video-player element,<br/>skins, loop/skip/repeat/chapters"]
  end

  subgraph shared["src/shared (pure, no DOM, no Node APIs)"]
    Types["types.ts"]
    HapticsShared["haptics.ts<br/>HapticChannel, channelKey"]
    Interp["interpolation.ts<br/>prepareScript, positionAt"]
    Chapters["chapters.ts, webvtt.ts"]
    Names["funscriptNames.ts, albums.ts"]
    Filtering["libraryFiltering.ts"]
    Dglab["dglab.ts<br/>path, subprotocols, grace"]
  end

  subgraph relay["dglab-relay/src (Node.js, bundled by esbuild)"]
    RelayServer["server.ts, relay.ts,<br/>jellyfinAuth.ts"]
  end

  AppIndex --> Player & LibraryUI & Haptic & Sync & JellyfinC & Utils
  JellyfinC --> Names & Chapters
  Player --> VJS
  Sync --> Interp
  Haptic --> Interp & HapticsShared & Dglab
  LibraryUI --> Filtering
  RelayServer --> Dglab
  client -. "types only" .-> Types
```

## Runtime responsibilities

| Concern | Where it runs | Main module |
| --- | --- | --- |
| Scan media, read tags, chapters, cover art | Jellyfin | — |
| Stream media with range requests, trickplay | Jellyfin | `/Videos/{id}/stream`, `/Audio/{id}/stream` (`static=true`) |
| Serve the app and the user docs | Jellyfin plugin | `WebController`, `DocsController` |
| Client settings and version | Jellyfin plugin | `HappyController`, `ClientSettings`, `configPage.html` |
| Index and serve funscripts | Jellyfin plugin | `FunscriptIndex`, `HappyController` |
| Jellyfin sign-in, library model | Browser | `JellyfinConnection`, `loadLibrary()`, `buildLibrary()` |
| Check Jellyfin tokens of relay controllers | DG-Lab relay | `jellyfinAuth.ts`, `server.ts` |
| Relay DG-Lab messages | DG-Lab relay | `DglabRelay` (`relay.ts`) |
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
    SC["src/client/** + src/shared/**"]
    SCSS["public/css/*.scss"]
    NM["node_modules<br/>bootstrap, icons"]
    Shell["public/index.html, img/"]
    Docs["docs/*.md + images"]
    DevDocs["docs/developer/**"]
    CS["jellyfin-plugin/**"]
    RS["dglab-relay/src/** + src/shared/dglab.ts"]
  end

  SC -- "esbuild<br/>scripts/build-client.js" --> JS["public/js/app.js"]
  SCSS -- sass --> CSS["public/css/app.css"]
  NM -- "scripts/copy-vendor-assets.js" --> Vendor["public/vendor/**"]

  JS & CSS & Vendor & Shell -- "embedded, no source maps" --> DLL[["Jellyfin.Plugin.Happy.dll<br/>happy_x.y.z.0.zip"]]
  CS -- "dotnet build<br/>package.sh" --> DLL
  Docs -- embedded --> DLL
  DevDocs -. "not embedded" .-x DLL
  RS -- "esbuild, Dockerfile" --> RelayImage[["happy-dglab-relay<br/>Docker image"]]
```

HAPPY and the plugin share one version (plugin `x.y.z.0`). Each release attaches the plugin zip to the GitHub release and adds it to the plugin repository's `manifest.json`, from which Jellyfin installs and updates it (see [jellyfin-plugin.md](jellyfin-plugin.md#releases-and-the-plugin-repository)). The relay has its own release cycle and image ([dglab-relay/README.md](../../dglab-relay/README.md)).

| Command | What it does |
| --- | --- |
| `npm run build` | `build:client` (sass + esbuild) → `build:vendor`; a Release plugin build needs this first |
| `npm run dev:client` / `npm run dev:css` | esbuild / sass in watch mode |
| `npm test` | `node --test` with `tsx` over `test/client`, `test/scripts` and `dglab-relay/test` |
| `npm run test:plugin` | `dotnet test` of the plugin in the .NET SDK container |
| `npm run dev:jellyfin` | Local Jellyfin with the fixtures and the working-tree plugin (see [local-jellyfin.md](local-jellyfin.md)) |
| `npm run test:jellyfin` | Integration tests against a real Jellyfin (see [jellyfin-plugin.md](jellyfin-plugin.md#testing-against-a-real-jellyfin)) |

## Code map

| Diagram | Based on |
| --- | --- |
| System context | [jellyfin-plugin/…/Api/](../../jellyfin-plugin/Jellyfin.Plugin.Happy/Api/HappyController.cs), [src/client/jellyfin/serverUrl.ts](../../src/client/jellyfin/serverUrl.ts), [src/client/jellyfin/](../../src/client/jellyfin/library.ts), [src/client/components/haptic/buttplugClient.ts](../../src/client/components/haptic/buttplugClient.ts), [dglab-relay/src/server.ts](../../dglab-relay/src/server.ts) |
| Code layers | `src/client`, `src/shared`, [dglab-relay/src](../../dglab-relay/src/relay.ts), [@/components/videojs](../../@/components/videojs/player.ts) |
| Build | [package.json](../../package.json), [scripts/build-client.js](../../scripts/build-client.js), [Jellyfin.Plugin.Happy.csproj](../../jellyfin-plugin/Jellyfin.Plugin.Happy/Jellyfin.Plugin.Happy.csproj), [package.sh](../../jellyfin-plugin/package.sh), [dglab-relay/Dockerfile](../../dglab-relay/Dockerfile), [.github/workflows/release.yml](../../.github/workflows/release.yml) |
