# Plan: Replace the clean-room DG-Lab V4 client with dglab-kit

HAPPY is now GPL-3.0-or-later, so dglab-kit (GPL-3, `dglab-kit@^1.0.5`, already in `package.json`) can be used in-process. Goal: replace HAPPY's own V4 client code (socket + protocol builders and parsers) with dglab-kit **without changing behaviour**. Work in two steps. Step 1 is read-only analysis and **must stop for user feedback if any functional difference is found**.

## Context

- **Keep HAPPY's relay** [src/server/services/dglabRelay.ts](../../src/server/services/dglabRelay.ts). dglab-kit has no relay. The official relay (dglab-websocket-server, Bun) has no login check, gives a random controller ID on every connection, and closes paired apps when the controller disconnects. HAPPY's relay has a stable controller ID derived from the login token (`deriveClientId`), a 5-minute grace period for reconnects, a login check on upgrade, and 'replaced' handling. Only the browser-side client gets replaced.
- **Client files in scope:**
  - [v4/socket.ts](../../src/client/components/haptic/dglab/v4/socket.ts) (`DglabV4Socket`): connect/disconnect, reconnect backoff (`RECONNECT_MAX_MS`), state and device events, `appCount`, `sentLog`, `happy-dglab-debug` tracing.
  - [v4/protocol.ts](../../src/client/components/haptic/dglab/v4/protocol.ts): `buildRequest`, `buildDevicesGet`, `buildSetTempIntensity`, `buildAppendPulseData` (`PULSE_VERSION=3`, `seq`, `im:true`), `buildResetIntensity`, `buildClear`, and normalisation of device snapshots and patches.
  - [coyoteBackend.ts](../../src/client/components/haptic/dglab/coyoteBackend.ts) is the only consumer. Keep its HAPPY-specific logic: `mapIntensity`, `channelCeiling`, `isChannelMuted`, `pushStrength`/`pushCarrier` timing, persistence, `stopAll`.
  - [waveform.ts](../../src/client/components/haptic/dglab/waveform.ts) is HAPPY logic (pulse rate/width → V3 frames). Keep it, unless dglab-kit offers an identical helper.
  - Pairing QR / `initDglab()` in [src/client/index.ts](../../src/client/index.ts).
- **dglab-kit surface** (`node_modules/dglab-kit/dist/*.d.ts`, `dist/index.js`):
  - `DglabSocket({url, protocols, connectTimeout, responseTimeout, version})`. `connect()` resolves `{targetId}` from the `hello` frame.
  - States: Idle / Connecting / WaitingForPeer / Paired / Disconnected.
  - Events: state, open, close, error, message, frame, data, action, device, devices, client-attached, client-disconnected.
  - V4 methods take `clientId` (the app connection): `clientIds`, `clients`, `getClient`, `requestDevices`, `setTempIntensity(clientId, slotId, channel, value, duration, opts)`, `sendPulse(clientId, slotId, channel, duration, frames, {version, seq, priority, immediate, timeout})`, `resetIntensity`, `addIntensity`, `clearOperate(clientId, {slotId, channel})`, `ping`, `send`.
  - Manual transport mode (`setSender` / `handleOpen` / `handleMessage` / `handleClose` / `handleError`) is useful for unit tests.
  - `V4Client` merges `devices.snapshot`, `devices.patch` and `slots.patch`. `V4Rpc` keeps a pending map with timeouts. `device.op` resolves only when the task ends, is cleared or is replaced.
  - Types/enums: `V4Channel`, `V4ActionType`, `V4DeviceInfo`, `V4SlotState`. Waveform data: `COYOTE_WAVEFORMS`, `OVC_WAVEFORMS`.
  - Dist uses global `WebSocket`, so it should bundle for the browser. Dependencies: `eventemitter3`, `ws` (check that esbuild does not pull in `ws`).

## Step 1: Equivalence analysis (read-only, no code changes)

Read the HAPPY files above plus `node_modules/dglab-kit/dist/index.js` and the `.d.ts` files. For each row below, record HAPPY's behaviour, dglab-kit's behaviour, and a verdict: **equal / different / missing in kit / missing in HAPPY**.

| # | Behaviour | What to check |
|---|-----------|---------------|
| 1 | Connect and `hello` | Is HAPPY's relay `hello` (stable token-derived ID) accepted, and is `targetId` exposed the same way? Do the pairing URL (`tid`) and the QR (`https://dungeon-lab.cn/s/?v=1&action=socket&url=…`) stay unchanged? |
| 2 | Reconnect | HAPPY auto-reconnects with backoff and keeps paired apps (stable ID plus relay grace). Does the kit reconnect at all? What happens to `clients` and devices after a reconnect? |
| 3 | Close handling | 'replaced' close reason; close codes 4000/4001/4002; `idle_timeout`; heartbeat/pong; difference between a user disconnect and a dropped connection. |
| 4 | Multiple apps | HAPPY `appCount` and how a device/slot is addressed to an app, compared with the kit's per-`clientId` model. Check `client_attached` / `client_disconnected` and whether devices are re-requested on attach. |
| 5 | Device model | Field-by-field compare of HAPPY's normalised device with `V4DeviceInfo`: slotId, type, props (power, channel status), `slotState` (intensityMax, comfortLimit, isMuted, markLight). **Are partial nested patches deep-merged?** Also check the `warmUpScale` churn filter and when the `devices` event fires. |
| 6 | Operation payloads | Exact JSON sent per operation: SetTempIntensity (`v`, `d`, `p`, `im`), AppendPulseData (`v` frames, `ver: 3`, `seq`, `d`, `p`, `im: true`), reset intensity, `device.op.clear`. Compare the kit's defaults for priority, immediate and version. |
| 7 | Responses and timeouts | HAPPY is fire-and-forget. The kit returns promises that resolve when the task ends and reject on timeout (default 8 s), during 10 strength messages/s and pulse messages every 800 ms. Check: pending-map growth, unhandled rejections, console noise, and the timeout behaviour for long tasks. |
| 8 | Errors | `error` frames (e.g. unknown client), malformed frames, the 64 KB frame limit. |
| 9 | Events not handled by HAPPY | `custom.action` and others: ignored, emitted, or logged? |
| 10 | Debug | `localStorage['happy-dglab-debug']` tracing and `sentLog` (200 cap): can the `frame`/`message` events cover them? |
| 11 | Waveform helpers | Does the kit encode frames/periods the same way as `flatFrame` / `pulsePeriodMs` (period byte compression for 101–1000 ms)? Are any HAPPY helpers redundant? |
| 12 | Bundle | `npm run build`: does `public/js/app.js` build and run in the browser without Node built-ins? Size difference. |

Optional automated check: write a throwaway script or test that connects the kit's `DglabSocket` (Node 22 global `WebSocket`) to HAPPY's relay, as set up in [test/server/dglabRelay.test.ts](../../test/server/dglabRelay.test.ts), and asserts the `hello`/targetId, attach and message paths.

**Output:** the filled-in table in chat.
**Gate:** if any row is *different* or *missing in kit* in a way users would notice (e.g. reconnect, patch merge, timeouts/rejections, payload defaults), **STOP and ask the user** how to proceed. Give options per row:
- (a) adapt in a HAPPY wrapper around the kit
- (b) accept the kit's behaviour
- (c) keep HAPPY's code for that part

Do not start Step 2 without the user's answers.

## Step 2: Replace the boilerplate with dglab-kit (after approval)

1. **Wrapper.** Rewrite `DglabV4Socket` in [v4/socket.ts](../../src/client/components/haptic/dglab/v4/socket.ts) as a thin wrapper around `DglabSocket`.
   - Keep the public API `CoyoteBackend` uses: `connect`, `disconnect`, `connectionState`, `targetId`, `appCount`, `devices`, `onStateChange`, `onDevicesChange`.
   - Replace `send(build)` with typed methods (`setTempIntensity`, `appendPulse`, `resetIntensity`, `clear`) that call the kit and swallow or log rejections.
   - Keep reconnect/backoff, 'replaced' handling and debug tracing in the wrapper if Step 1 shows the kit lacks them.
2. **Types.** Use the kit's types and enums (`V4Channel`, `V4ActionType`, `V4DeviceInfo`) instead of HAPPY's own in `coyoteBackend.ts`. Keep HAPPY-only helpers (ceiling, mute, churn filter) where they are, or move them into the wrapper.
3. **Delete** the builders and parsers in [v4/protocol.ts](../../src/client/components/haptic/dglab/v4/protocol.ts) that the kit replaces. Keep only what Step 1 marked "missing in kit"; remove the file if nothing is left.
4. **Waveform.** Keep [waveform.ts](../../src/client/components/haptic/dglab/waveform.ts) unless Step 1 found an identical kit helper.
5. **Tests.**
   - Rewrite the builder tests in [test/client/dglabProtocol.test.ts](../../test/client/dglabProtocol.test.ts) as wrapper tests using the kit's manual transport (`setSender` / `handleMessage`). Assert the exact outgoing JSON from Step 1, row 6.
   - Keep the `waveform.ts` tests.
   - Keep [test/client/coyoteMapping.test.ts](../../test/client/coyoteMapping.test.ts) green.
   - Keep the relay tests and optionally add the kit↔relay interop test.
6. **Docs.**
   - [docs/developer/haptics.md](../../docs/developer/haptics.md): the DG-Lab section now uses dglab-kit, plus the wrapper's responsibilities.
   - [LICENSES.md](../../LICENSES.md): add dglab-kit (GPL-3.0) and eventemitter3 (MIT).
   - [ARCHITECTURE.md](../../ARCHITECTURE.md) and [docs/dg-lab.md](../../docs/dg-lab.md) if they mention the clean-room client.
7. **Commit.** Use conventional commits, e.g. `refactor(dglab): use dglab-kit for V4 client`.

## Verification

1. `npm test`: all tests pass (baseline 208).
2. `npm run build`: the bundle builds, `ws` and Node built-ins are not in `public/js/app.js`, and the size change is noted.
3. Manual with the DG-Lab app and a Coyote 3:
   - pair via QR
   - reload the page: apps stay paired with no re-scan
   - strength follows the funscript
   - pulse rate/width sliders change the feel
   - pause/stop is silent immediately
   - closing the tab auto-stops within ~300 ms
   - two apps attached at once
   - `happy-dglab-debug` tracing still works
   - no unhandled promise rejections in the console during 5 minutes of playback

## Out of scope

- The relay server. It stays as it is.
- Waveform-driven playback and the developer "Coyote Lab" (follow-up plan, to be built on the new wrapper).
- Any change to intensity mapping, timing constants or the UI.