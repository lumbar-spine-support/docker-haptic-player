# HAPPY Developer Guide

These pages explain how HAPPY works inside: which modules exist, how they talk to each other and what happens step by step in the common use cases. Most of the explanation is in [Mermaid](https://mermaid.js.org/) diagrams, which GitHub and VS Code render directly.

> These pages are for development only. They are **not** served in the app and **not** copied into the Docker image (see `.dockerignore`). The user documentation lives one level up in [docs/](../index.md).

[ARCHITECTURE.md](../../ARCHITECTURE.md) is the short reference with the rules and conventions. These pages are the visual walkthrough.

## Reading order

| Page | What you learn |
| --- | --- |
| [architecture.md](architecture.md) | The big picture: processes, network connections, module layers, build and deployment |
| [server.md](server.md) | Express pipeline, configuration, HAPPY's password gate, WebSocket upgrades, DG-Lab relay |
| [client.md](client.md) | App bootstrap, Jellyfin data layer, routing, the two-player playback model |
| [haptics.md](haptics.md) | Backends, channels and features, the funscript pipeline, the sync loop, the e-stim sandbox |
| [jellyfin-plugin.md](jellyfin-plugin.md) | The Jellyfin companion plugin: funscript endpoints, matching, building, testing against a real Jellyfin |

### Use cases

Each use case follows one user action from start to finish, across client, server and external apps.

| Use case | Covers |
| --- | --- |
| [Log in](use-cases/login.md) | Jellyfin sign-in, HAPPY password and token cookie, logout |
| [Load the library from Jellyfin](use-cases/library-load.md) | Items, funscript listing, playlists, client-side mapping, new files |
| [Browse and play a track](use-cases/browse-and-play.md) | Opening a track, pressing play, player handoff, autoplay |
| [Connect Intiface and a toy](use-cases/intiface-pairing.md) | Intiface connection, device discovery, disconnects |
| [Assign a device feature](use-cases/assign-feature.md) | Mapping an actuator to a funscript channel, strength, stroker range |
| [Pair a DG-Lab Coyote](use-cases/coyote-pairing.md) | Relay, QR code and deep link, device snapshot, output, timeouts |

## Glossary

| Term | Meaning |
| --- | --- |
| **Track** | One playable audio or video item. The id is the Jellyfin item id. |
| **Funscript** | A JSON file with `actions: [{ at, pos }]` (ms, 0–100). It belongs to a track by filename stem; the HAPPY Jellyfin plugin serves it by an opaque key. |
| **Channel** | Funscript type plus an optional subcategory, e.g. `estim` or `estim:nipples` (`HapticChannel`, `channelKey()`). |
| **Backend** | One haptic transport behind the `HapticBackend` interface: Intiface (`ButtplugClientManager`) or DG-Lab (`CoyoteBackend`). |
| **Feature** | One actuator of a device (vibrator, rotator, linear axis, e-stim channel). Features are assigned to channels. |
| **Active / focused slot** | The two `<video-player>` instances: *active* owns playback and haptics, *focused* is the one on screen. |
| **Relay** | The server-side WebSocket at `/ws/dglab` that connects a browser tab (controller) with the DG-Lab app. |

## Keeping these docs up to date

The diagrams name **modules, classes and functions**, not line numbers, so they survive most edits. When you refactor:

1. Check the **Code map** table at the end of each page you touched. It lists the files each diagram is based on.
2. Rename the participants or nodes in the diagrams if you renamed a class or moved a responsibility.
3. If you add a use case, add a page under `use-cases/` and a row to the table above.
4. Preview with the VS Code Markdown preview (Mermaid support is built in with recent versions, or via the *Markdown Preview Mermaid Support* extension) or on GitHub.

Mermaid tips that avoid broken diagrams:

- Quote labels that contain punctuation: `A["label (with) punctuation"]`.
- Don't use `#` followed by text and `;` in labels (Mermaid reads it as an HTML entity).
- Don't use a node id called `end` in flowcharts.

## Updating Video.JS player skin

First overwrite the skin files.

```
npx shadcn@latest add @videojs/video --overwrite --yes
```

Then check with git diff what has changed and reintegrate custom changes.