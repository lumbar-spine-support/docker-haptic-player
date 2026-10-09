# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HAPPY is a self-hosted haptic player for audio/video files: a browser client (`src/client/`) that takes its library and streams from a Jellyfin server, plays media with Video.js v10 and drives toys through Intiface/Buttplug or a DG-Lab Coyote. A small Express server (`src/server/`) serves the client, its config, the docs and the DG-Lab relay; a Jellyfin plugin (`jellyfin-plugin/`, C#) serves funscripts.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before non-trivial changes.** It holds the rules and invariants. [docs/developer/](docs/developer/README.md) has diagrams and step-by-step use cases. Don't duplicate them here; update them instead (see below).

## Commands

```bash
npm run build          # server (tsc) + client (sass + esbuild) + vendor assets
npm start              # node dist/server/index.js (needs a build first)
npm run dev:client     # esbuild watch for the client bundle (no CSS; run build:css separately)
npm run build:css      # compile public/css/*.scss
npm test               # all tests: node:test via tsx over test/server and test/client
npm run test:jellyfin  # opt-in integration tests against a real Jellyfin (reads gitignored config/test.env)
npm run test:coverage  # what CI runs (Node 26)
npm run docs:env       # regenerate the env-var tables in README/docs from Config.DEFAULTS/ENV_NAMES/DESCRIPTIONS
npm run sandbox        # standalone e-stim waveform sandbox at :8100 (sandbox/)
```

Single test file / single test:

```bash
NODE_ENV=test node --import tsx --test test/server/config.test.ts
NODE_ENV=test node --import tsx --test --test-name-pattern="some name" test/client/skip.test.ts
```

Type-check (no lint script exists): `npx tsc --noEmit -p tsconfig.json` (covers `src`, `@`, `test`, `scripts`). The client config additionally enables `noUnusedLocals`/`noUnusedParameters`: `npx tsc --noEmit -p tsconfig.client.json`.

Server integration tests use `test/helpers/index.ts` (`startTestServer`, which injects a stub Jellyfin token verifier that accepts `TEST_JELLYFIN_TOKEN`; use `TEST_APP_DEPENDENCIES` when calling `createApp` yourself). Tests against a real Jellyfin live in `test/integration/jellyfin/` and run only via `npm run test:jellyfin` (see `docs/developer/jellyfin-plugin.md`).

## Layout and build

- `src/server/` — compiled by `tsc` (`tsconfig.server.json`, Node16 modules) to `dist/`.
- `src/client/` — bundled by esbuild (`scripts/build-client.js`) into `public/js/app.js`.
- `src/shared/` — pure code used by both sides (haptic channels, interpolation, VR format detection, chapters/WebVTT, library filtering). Keep it free of DOM and Node APIs.
- `@/components/videojs/` — Video.js v10 skin, features (chapters, loop, repeat, skip, vr) and UI elements, imported via the `@/*` path alias (tsconfig `paths` + esbuild `alias`).
- `.html` and `.svg` files are imported as text strings (esbuild `text` loader) and used as templates via `src/client/utils/template.ts`. Tests that transitively import templates must register a `.html` loader (see `test/client/library.test.ts` or `test/helpers/htmlLoader.mjs`).
- `public/` holds the static shell, SCSS and icons; generated output (`public/js`, `public/vendor`, compiled CSS) is gitignored.
- `config/` (gitignored) is the local stand-in for the `/config` volume: `settings.yaml` (set `JELLYFIN_URL` there for local runs) and `test.env` for `npm run test:jellyfin`.
- `jellyfin-plugin/` — the HAPPY Jellyfin plugin (.NET 10); build and test with the .NET SDK (`dotnet test jellyfin-plugin/Jellyfin.Plugin.Happy.slnx`, `sh jellyfin-plugin/package.sh`).
- `docs/*.md` are user docs, served in-app at `/docs` and shipped in the Docker image. `docs/developer/` is dev-only and excluded from the image.

## Key architectural points (details in ARCHITECTURE.md)

- The server is stateless with respect to playback; all playback, haptic timing and device state live in the browser. The only exception is the DG-Lab `/ws/dglab` relay, a dumb single-slot passthrough that never parses device commands.
- **Two-player model:** the client keeps two `<video-player>` slots (`PlaybackSession` in `src/client/components/player/session.ts`). Browsing loads the idle slot without interrupting playback; only pressing play promotes a slot to active (footer, haptics, Media Session follow). Nothing is re-parented during handoff.
- **Haptics:** `HapticBackend` interface with `ButtplugClientManager` (Intiface) and `CoyoteBackend` (DG-Lab). Each backend gets its own `FunscriptSync`; `HapticBackendRegistry` is only for combined status/stop-all. Sync style is chosen by the assigned *actuator* type (scalar/rotate interpolate continuously, linear is edge-triggered), not by script type. Channels are `<stem>.<type>[.<sub>].funscript`.
- **Jellyfin:** the client signs in to Jellyfin and loads the whole library once (`src/client/jellyfin/`; `api.ts` stays the single data facade). Albums, tags (Tags ∪ Genres) and funscript types are derived client-side; chapter/storyboard WebVTT are `blob:` URLs; media plays direct (`static=true`) with `crossorigin="anonymous"`. Never commit the Jellyfin address or credentials used for testing; integration tests assert shapes only.
- **Auth:** Jellyfin is the only sign-in (token in `localStorage`, `ApiKey` in stream URLs, which also covers Chromecast). The HAPPY server's shell, `/api/config`, `/api/version` and `/api/docs` are public. The DG-Lab relay checks a HAPPY tab's Jellyfin token, offered as the `jellyfin.<token>` WebSocket subprotocol, with `GET /Users/Me` (`services/jellyfinAuth.ts`); apps pair with the unguessable `tid`.
- **Configuration:** `src/server/config.ts` defines `DEFAULTS`, `ENV_NAMES` and `DESCRIPTIONS`; env vars override `settings.yaml`. After adding or changing an option, run `npm run docs:env`. Only the client-visible subset is exposed through `/api/config`.

## Conventions

- After edits: ensure no TypeScript errors and run `npm test`.
- User-facing changes → update user docs in `docs/`. Implementation/architecture/refactoring changes → update `docs/developer/` (and ARCHITECTURE.md where rules change).
- Conventional Commits (`feat(scope):`, `fix:`, `refactor:`, `chore:`, `docs:`); release-please generates the changelog and releases from them. PRs are rebased, not merged, and kept narrow in scope.
- VR180/WebXR work: follow the staged plan in `.github/instructions/webxr-vr180.instructions.md` (capability-based detection, no auto-entering immersive mode).
