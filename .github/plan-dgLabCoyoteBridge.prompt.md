# Plan: DG-Lab Coyote 3.0 bridge via self-hosted V4 relay

## TL;DR
Add DG-Lab Coyote 3.0 support by (a) hosting a **DG-Lab V4 WebSocket relay** inside HAPPY's
Express server, (b) making the **browser the V4 control side** via a clean-room MIT
implementation of the documented V4 protocol, and (c) extracting a `HapticBackend` interface
so the Coyote sits alongside `ButtplugClientManager` without touching `FunscriptSync`'s
interpolation/seek/delay logic. The DG-Lab app remains the owner of all safety limits.
The whole feature is gated behind a config flag that is surfaced to the client, so both the
WS endpoint and the sidebar UI disappear when disabled.

## Decisions (locked with user)
- Relay: **HAPPY's own server** (self-hosted, LAN-friendly).
- Protocol: **V4 only** (no V3 fallback).
- Abstraction: **extract `HapticBackend`**, add Coyote as second backend. No dynamic plugin loader.
- Mapping: **funscript position -> channel strength**; waveform fixed/minimal. A and B exposed
  as two assignable features reusing existing `DeviceAssignment` UI + localStorage.
- Carrier waveform: **accepted** - constant flat carrier, one exposed "pulse frequency" setting.
- **No QR code.** HAPPY is usually already open *on* the phone, so there is nothing to scan
  with. Use a tappable `https://dungeon-lab.cn/s/?v=1&action=socket&url=...` deep link that
  hands off to the DG-Lab 4 app directly, plus a copyable raw URL as fallback.
- **Feature flag**, default off, plumbed through to `ClientConfig` so the UI can hide the
  DG-Lab settings section entirely.

## Rejected options (with reasons)
- Upstream PR to buttplug: `Ljzd-PRO/buttplug-dg-lab` already did this; upstream declined
  ("Buttplug is not suitable for products like the Coyote"). Dead end.
- Fork intiface + own build pipeline: that fork is 2 years stale, 3 Rust/Flutter submodules,
  native BLE, per-OS builds. Out of scope for a Docker Node app.
- "Bridge served by the client in the browser": physically impossible, a browser cannot
  accept WS connections. Collapses into the relay option.
- Web Bluetooth direct: requires secure context; documented default deploy is plain HTTP
  over LAN. Revisit later as an optional extra.
- External bridge app (CoyoteSocket, MIT, Tauri): zero code but desktop-only, breaks
  self-hosted browser-only ethos. Mention in docs as an alternative.

## Licensing constraint (hard)
`dglab-kit` and `dglab-websocket-server` are **GPL-3.0**; this repo is **MIT** and bundles
client deps into `public/js/app.js`. DO NOT take a dependency on them. The V4 wire format is
fully documented in their READMEs and is not copyrightable -> clean-room implementation.

## Protocol facts established (from dglab-kit README V4 reference)
Relay frames (server<->client):
- `{type:'hello', clientId}` on connect (both sides)
- controller connects with no query; app connects with `?tid=<controllerClientId>`
- `{type:'client_attached'|'client_disconnected', clientId}` -> controller
- `{type:'controller_attached'|'controller_disconnected', clientId}` -> app
- `{type:'message', clientId, data}` passthrough both directions (relay does NOT parse `data`)
- `{type:'heartbeat'}` every 30s; `{type:'ping'}` -> `{type:'pong', ts}`
- `{type:'idle_timeout'}` then close, if no app attaches within 5 min
- Close codes: 4000 controller_disconnected, 4001 controller_not_found, 4002 idle_timeout
- Errors: `bad_request`, `client_not_found`, `controller_not_found`

App-layer (inside `message.data`), `t` = `req` | `resp` | `ev`:
- req: `{t:'req', reqId, m, data}`; resp: `{t:'resp', reqId, result|error}`
- Methods: `devices.get`, `device.op`, `device.op.clear`, `ping`
- Events: `devices.snapshot`, `devices.patch` (added[]/removed[]), `slots.patch`, `custom.action`
- `device.op` data common fields: `s` slotId, `t` ActionType, `c` channel (0=A,1=B),
  `p` priority, `d` duration ms, `im` replace-same-task
- ActionTypes: `0` AppendPulseData (`v` frames, `ver`, `seq`), `3` AddIntensity (`v`, oneShot),
  `4` SetTempIntensity (`v`, `d`, continuous, auto-resets to 0 on task end),
  `7` SetIntensity (**only accepts v:0** - reset only)
- `device.op` RPC responses are LONG-LIVED: they only return when the task completes/is
  cleared/replaced/cancelled. Never await them in the hot path.
- Pulse frames consumed **one per ~100ms tick**. V3 frame = `[a1,a2,a3,a4,b1,b2,b3,b4]`
  or hex string like `"0A0A0A0A00000000"` (4 freq bytes + 4 intensity bytes, 25ms each).
- Device type for Coyote 3 is `COYOTE_030`.
- `props`: `power`, `version`, `intensityA`, `intensityB`, `connectState`,
  `channelAStatus`/`channelBStatus` (0 none,1 no circuit,2 ok,3 damaged,4 masked)
- `slotState.channelA/B`: `isMuted`, `warmUpScale`, `intensityMax`,
  `comfortLimit{mode,comfortMax,absoluteMax,overheat,overheatPercent,autoIncr,...}`
  -> `intensityMax` is the hard ceiling to clamp against and display.
- QR pairing: `https://dungeon-lab.cn/s/?v=1&action=socket&url=<urlencoded ws url with ?tid=>`

### KEY CONSEQUENCE for mapping
`SetIntensity` cannot set an arbitrary absolute value. Use **`SetTempIntensity` with
`im:true`**, resent periodically with `d` slightly longer than the resend interval. This gives
absolute values AND a built-in dead-man's switch (auto-zero if we stop sending).

### KEY CONSEQUENCE for "zero waveform"
User asked for "fixed preset waveform, ideally zero". A zero waveform produces **no output at
all** - the Coyote emits pulses and strength scales their amplitude. A minimal constant carrier
MUST be pumped continuously (e.g. flat frame `0A0A0A0A64646464` = freq 10, intensity 100).
**Accepted by user**: constant full-intensity flat carrier, one exposed "pulse frequency"
setting.

### Pairing without a QR code
The DG-Lab docs offer two handoff routes: scan a QR, *or* navigate the browser to the
`dungeon-lab.cn/s/` deep link. Since HAPPY is typically already open on the phone, the deep
link is strictly better - one tap, nothing to scan. Render it as an anchor plus a copyable
raw `ws://` URL for the desktop-browser case, where the user types it into the app by hand.

## Codebase facts
- Server: Express 5, `createApp()` in `src/server/index.ts` L23-52; `main()` calls
  `app.listen()` without retaining `http.Server` (L59-62). **No WebSocket anywhere.** `ws`
  is not a dependency.
- Auth: `createAuthMiddleware()` mounted after `/api/auth`. **Express middleware does NOT run
  on HTTP upgrades** - token check must be hand-rolled on the upgrade handshake.
- ARCHITECTURE.md L10 states the server is stateless w.r.t. playback and haptics. A dumb
  passthrough relay keeps control logic in the browser but the doc needs an explicit carve-out.
- Buttplug integration is a single file: `src/client/components/haptic/buttplugClient.ts`.
  `buttplug` is a devDependency (bundled into browser build only).
- `ButtplugClientManager` narrow consumed surface: `onStateChange`, `onDevicesChange`,
  `onAssignmentsChange`, `connectionState`, `devices`, `getFeatures`, `setFeatureChannel`,
  `getFeatureChannel`, `getDeviceStrength`, `setDeviceStrength`, `hasFeaturesFor`,
  `hasLinearFor`, `sendContinuous`, `sendLinear`, `getBatteryLevel`, `stopAll`,
  `masterStrength`, `setLinearRange`.
- `FunscriptSync` (`src/client/components/funscriptSync.ts`): self-rescheduling
  `window.setTimeout` at 1000/frequencyHz, **default 30 Hz, resends every tick**. `rafHandle`
  (L39) is dead code. Private helpers `interpolatedPosition` L197, `nextStrokerWaypoint` L209,
  `findBracketIndex` L226.
- `DeviceFeature.id` format `<deviceName>#<kind>#<index>` via `makeFeatureId` L42 - plain
  string, so Coyote can mint ids in the same namespace.
- Channels: `src/shared/haptics.ts` - `HapticChannel {type, sub?}`, `channelKey`,
  `FUNSCRIPT_TYPES` already contains `estim`.
- Persistence: localStorage only. `happy-feature-assignments`, `happy-device-strengths`,
  `happy-stroker-range`, `happy-intiface-address`, `happy-haptic-strength`,
  `happy-haptic-delay-ms`, `happy-haptic-update-rate-hz`.
- Settings offcanvas `#settings-panel` in `public/index.html`, stacked `.settings-section`
  divs: Intiface / `#device-assignment` / Haptic Strength / Delay / Update Frequency / Blur.
- Routes pattern: `createXRouter(deps): Router` in `src/server/routes/`.
- **Config gotchas** (`src/server/config.ts`): adding a key means touching four parallel
  structures - the `ServerConfig`/`ClientConfig` interface, `DEFAULT_*_CONFIG` (which is what
  `SERVER_KEYS`/`CLIENT_KEYS` are derived from), `DESCRIPTIONS`, and `ENV_NAMES`. A key with
  no `ENV_NAMES` entry is skipped by `getDefaultSettingsYaml()` and has no YAML form at all.
  `applyConfigValue()` coerces by `typeof` of the *current* value and handles only `string`,
  `number`, and comma-split `string[]` - **there is no boolean branch**, so a boolean flag
  needs either a new branch or a `number`/`string` representation.
- **`ClientConfig` is never sent to the browser.** It holds one field, `videoSeekInterval`,
  marked "(TODO: unused)", and no route surfaces it. Gating UI on server config therefore
  requires a new endpoint - this is new plumbing, not a tweak.
- Tests: `node:test` + `tsx`. `npm test` globs `test/server` + `test/client` for `*.test.ts`.
  `NODE_ENV=test` prevents `main()` binding a port. Helpers: `startTestServer()` (seeds auth
  token as `happy_token` cookie), `withMediaFixtures()`. Client tests stub
  `globalThis.window`/`document` then dynamic-`import()` inside `test.before()`.
  **No lint script exists.** No existing tests for any haptic code.
- Build: `npm run build` = tsc server -> sass+esbuild client -> copy vendor.
  esbuild entries `src/client/index.ts` and `src/client/login.ts`, alias `@` -> repo `@/`.
- Conventional Commits + release-please. `feat`/`fix`/`perf`/`revert` visible in changelog.
- License MIT. LICENSES.md tracks third-party licenses - must add entry for any new dep.

## Phases

### Phase 0 - Protocol spike (do first, throwaway)
Goal: de-risk before committing. Scratch HTML page or `tsx` script, not committed.
1. Stand up a minimal V4 relay + control side; pair with the real DG-Lab 4 app + Coyote 3.
2. Verify: does `SetTempIntensity` set an **absolute** value or an **additive** offset over the
   app's base intensity? This determines the whole mapping. (Primary unknown.)
3. Verify a flat carrier frame produces sensation, and find a sane default frequency byte.
4. Measure: max safe `device.op` rate before the app/device chokes. Confirm 10 Hz is safe.
5. Confirm `slotState.channelA.intensityMax` reflects the app's configured comfort limit.
Output: recorded constants + confirmed semantics. Blocks Phase 4.

### Phase 1 - Server relay (parallel with Phase 2 & 3)
1. Add `ws` + `@types/ws` to `package.json`. `ws` must be a real **dependency** (server
   runtime), unlike `buttplug`. Add to LICENSES.md.
2. **Feature flag + client config plumbing** (do this first, everything else hangs off it):
   - Add `dglabEnabled` to `ClientConfig` (not `ServerConfig` - it must reach the browser),
     default off. Add matching `DEFAULT_CLIENT_CONFIG`, `DESCRIPTIONS`, and `ENV_NAMES`
     (`DGLAB_ENABLED`) entries, or it gets no YAML form.
   - Add a `boolean` branch to `applyConfigValue()` accepting `true/false/1/0/yes/no`. This is
     the first boolean config key in the project, so the coercion gap has to be closed.
   - New `src/server/routes/config.ts` -> `createConfigRouter(config)` exposing `GET
     /api/config` returning the `ClientConfig` object only. Mount **after**
     `createAuthMiddleware()` so it inherits the token guard. Never leak `ServerConfig`
     (it contains filesystem paths).
3. Refactor `main()` in `src/server/index.ts` to retain the `http.Server` from `app.listen()`.
   Keep the `NODE_ENV=test` guard intact.
4. New `src/server/services/dglabRelay.ts`: `createDglabRelay(tokenStore, config)` returning
   `{ handleUpgrade(req, socket, head), close() }`. Implements exactly the frame set above.
   - `clientId` via `crypto.randomUUID()` (unguessable - the app side's only credential).
   - Maps: `controllers: Map<clientId, Conn>`, `apps: Map<clientId, Conn>`, plus
     controller -> Set<appClientId>.
   - 30s heartbeat, 5-min idle timeout, close codes 4000/4001/4002.
   - Pure passthrough of `message.data` - never parse or validate device commands.
5. **Auth on upgrade** (security-critical, do not skip):
   - Controller connections (no `tid`): parse the `happy_token` cookie from the upgrade
     request and validate against `tokenStore`. Reject with `401` + destroy socket otherwise.
   - App connections (`?tid=`): cannot present a cookie. Authenticated by possession of the
     unguessable `tid` alone. Reject unknown `tid` with close 4001.
   - Cap concurrent controllers per token and apps per controller; drop excess.
   - Respect `TRUST_PROXY` semantics already used by `loginThrottle`.
6. Wire `server.on('upgrade', ...)` in `main()`, path-gated to `/ws/dglab`; destroy sockets
   on any other upgrade path. **When `dglabEnabled` is false, never register the relay at
   all** - the endpoint should not exist, not merely reject.

### Phase 2 - Clean-room V4 client (parallel with Phase 1)
New dir `src/client/components/haptic/dglab/`:
1. `protocol.ts` - pure, dependency-free: relay frame + app-message types, `V4ActionType`,
   `V4Channel`, and builder functions (`buildSetTempIntensity`, `buildAppendPulseData`,
   `buildClear`, `buildDevicesGet`). Pure functions = directly unit-testable.
2. `socket.ts` - `DglabV4Socket`: WebSocket lifecycle, `hello` -> `targetId`,
   `client_attached`/`client_disconnected`, `reqId` correlation with timeout, device cache
   (`devices.snapshot` replace, `devices.patch` add/remove, `slots.patch` **deep merge** by
   slotId), heartbeat handling, reconnect/backoff, event emitter.
   - Fire-and-forget for `device.op` (long-lived responses); only `devices.get`/`ping` await.
3. `waveform.ts` - the constant carrier frame constant(s) and a `frequency -> frame` helper.

### Phase 3 - Extract `HapticBackend` (parallel with Phases 1-2; blocks Phase 4)
1. New `src/client/components/haptic/backend.ts` declaring `HapticBackend` from the narrow
   surface listed above. Add `'estim'` to `FeatureKind`.
2. `ButtplugClientManager implements HapticBackend` - pure type change, zero behaviour change.
3. Retype `FunscriptSync`, `DeviceStatus`, `DeviceAssignment`, `HapticControls` against
   `HapticBackend` (they already use type-only imports, so this is mechanical).
4. New `HapticBackendRegistry` implementing `HapticBackend` by fan-out: merges `devices` and
   `getFeatures` across backends, routes `sendContinuous`/`sendLinear` to every backend that
   `hasFeaturesFor` the channel, `stopAll` hits all. `FunscriptSync` takes the registry.
   This keeps both backends live simultaneously.
5. In `FunscriptSync.updateScript()`, add an `estim` branch so position maps to strength
   rather than falling through the scalar path.

### Phase 4 - Coyote backend (depends on 0, 2, 3)
`src/client/components/haptic/dglab/coyoteBackend.ts` - `CoyoteBackend implements HapticBackend`:
1. Feature minting: for each `COYOTE_030` slot, two features with ids
   `Coyote 3.0 (<slotId>)#estim#0` and `#1`, kind `'estim'`, labels "Channel A"/"Channel B".
   Reuses existing assignment UI + `happy-feature-assignments` persistence unchanged.
2. `sendContinuous(channel, intensity)`:
   - Throttle to ~10 Hz and suppress sends when the mapped integer value is unchanged
     (`FunscriptSync` calls at 30 Hz and resends every tick - naive passthrough floods the relay).
   - `value = round(intensity * masterStrength * deviceStrength * intensityMax)`,
     hard-clamped to `slotState.channel*.intensityMax`.
   - Emit `SetTempIntensity` with `im:true`, `d` ~300ms (> resend interval, so it never gaps
     but auto-zeroes if the tick loop dies).
3. Carrier pump: independent timer emitting `AppendPulseData` every ~800ms with 10 identical
   flat frames and `d:1000`, per assigned channel. Stops when no channel is assigned.
4. `sendLinear` -> no-op; `hasLinearFor` -> `false`; `getBatteryLevel` -> `props.power`.
5. `stopAll()` -> `device.op.clear` for the slot + `SetIntensity v:0` on both channels.
6. Safety: force strength 0 on pause, seek, disconnect, page hide/unload, and when
   `channel*Status` reports no circuit (1) or damaged (3).

### Phase 5 - UI (depends on 4)
1. New `.settings-section` in `public/index.html` after the Intiface section: status badge
   (`#dglab-status`), "Pair DG-Lab app" button, pairing link container, copyable raw URL,
   disconnect button. Match the existing `.settings-control` label+control structure.
2. **Gate on `dglabEnabled`**: `App` fetches `GET /api/config` at boot and removes (not just
   hides) the whole section when the flag is off. Skip constructing `CoyoteBackend` and
   registering it with the backend registry in that case too.
3. Pairing handoff - **no QR code**:
   - Build the ws URL from `window.location.host` (the LAN IP the phone can reach), NOT
     `localhost`. Plain `ws://` is fine - the DG-Lab app is native, no mixed-content rule.
   - Render a tappable anchor to
     `https://dungeon-lab.cn/s/?v=1&action=socket&url=<encodeURIComponent(wsUrl)>`, which the
     phone hands straight to the DG-Lab 4 app.
   - Also show the raw `ws://host/ws/dglab?tid=<targetId>` string with a copy button, for when
     HAPPY is open on a desktop browser and the user enters it on the phone manually.
4. Surface per-channel `intensityMax` / comfort limit read-only, so the user can see the cap
   the DG-Lab app is enforcing.
5. `DeviceStatus` badges need no change - they key off channel assignment already.

### Phase 6 - Tests & docs
1. `test/server/dglabRelay.test.ts` using `startTestServer()`:
   - upgrade without a valid `happy_token` cookie is rejected (**the key security test**)
   - controller gets `hello`; app with valid `tid` attaches, both sides notified
   - app with unknown `tid` closed with 4001
   - `message` passthrough in both directions, with `clientId` stamped correctly
   - controller disconnect closes attached apps with 4000
   - non-`/ws/dglab` upgrade paths are destroyed
   - **with `dglabEnabled` false, `/ws/dglab` upgrades are refused outright**
2. `test/server/config.test.ts` additions - boolean coercion in `applyConfigValue()`
   (`true/false/1/0/yes/no`), and `GET /api/config` returning `ClientConfig` only, never
   `ServerConfig` paths, and requiring auth.
3. `test/client/dglabProtocol.test.ts` - pure frame builders + `slots.patch` deep merge.
4. `test/client/coyoteMapping.test.ts` - intensity mapping, clamping, throttle/change
   suppression. Requires these to be exported free functions, not private methods.
5. Docs: ARCHITECTURE.md (carve-out for the relay against the L10 stateless invariant, the
   backend registry, and the new `/api/config` client-config channel), README.md (enabling
   the flag, pairing walkthrough via deep link, LAN IP caveat, safety note),
   LICENSES.md (`ws`).

## Out of scope (explicit)
Web Bluetooth direct path; Coyote 2.0 / `COYOTE_020`; other DG-Lab devices (OVC, BMTR);
V3 protocol; upstream buttplug PR; forking intiface; waveform editor / multiple presets;
QR code generation; server-side persistence of haptic settings; a generic dynamic plugin
loader.

## Verification
1. `npm run build` clean; `npm test` green.
2. Relay unit tests cover the auth-on-upgrade path.
3. With the flag off (default): no `/ws/dglab` endpoint, no DG-Lab section in the sidebar,
   no `CoyoteBackend` constructed. Flip it on and both appear after reload.
4. Manual, real hardware: tap the pairing link on the phone -> DG-Lab app opens and attaches
   -> device appears in Device Assignment -> assign A/B to `estim` -> play a track with an
   `estim` funscript -> strength tracks the script.
5. Safety drills: pause, seek, close tab, kill server, phone leaves wifi -> output stops
   within ~300ms in every case (the `SetTempIntensity` `d` window).
6. Confirm strength never exceeds the limit configured in the DG-Lab app.
7. Watch relay traffic: confirm <= ~10 strength msgs/sec/channel during dense script sections.
8. Regression: Buttplug/Intiface path still works unchanged with a real toy.

## Resolved considerations
1. Carrier waveform - **accepted**. Constant flat carrier, one exposed frequency setting.
2. QR code - **dropped**. HAPPY is usually already open on the phone, so there is no second
   screen to scan from. Deep link + copyable URL instead. No new dependency.
3. Feature flag - **yes**, and it lives in `ClientConfig` so it reaches the browser via a new
   `GET /api/config` endpoint and the sidebar section can be removed when disabled.
