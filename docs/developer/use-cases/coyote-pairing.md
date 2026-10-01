[← Developer Guide](../README.md)

# Use case: Pair a DG-Lab Coyote

**Goal:** the user connects a DG-Lab Coyote 3.0 so it follows e-stim scripts.

The Coyote talks Bluetooth only to the **DG-Lab app** on a phone. The app, in turn, connects to a WebSocket relay using the DG-Lab V4 socket protocol. HAPPY hosts that relay itself at `/ws/dglab`. The relay is a dumb passthrough: it pairs one browser tab (the **controller**) with up to four apps and forwards opaque frames. All haptic logic stays in the browser and all safety limits stay in the app.

```mermaid
flowchart LR
  Browser["Browser tab<br/>CoyoteBackend + DglabV4Socket"] <-- "wss /ws/dglab<br/>cookie auth" --> Relay["HAPPY server<br/>dglabRelay"]
  Phone["DG-Lab app"] <-- "wss /ws/dglab?tid=…<br/>tid is the credential" --> Relay
  Phone <-- Bluetooth --> Coyote["Coyote 3.0"]
```

## Preconditions

- `DGLAB_ENABLED=true`. Without it the server does not attach the relay, and the client removes the DG-Lab section from the settings panel (`App.initDglab`).
- The phone must reach the HAPPY server. When the browser uses `localhost`, the server cannot know its own LAN address, so the user enters the host in the pairing host field (`happy-dglab-pairing-host`).

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as Settings panel<br/>App.initDglab
  participant CB as CoyoteBackend
  participant SK as DglabV4Socket
  participant R as Relay (server)
  participant P as DG-Lab app
  participant C as Coyote

  U->>UI: press Connect
  UI->>CB: connect()
  CB->>SK: connect(ws(s)://host/ws/dglab)
  SK->>R: WebSocket upgrade with auth cookie
  R->>R: no tid: verify cookie, else 401
  R->>R: controller id = deriveClientId(token)
  R-->>SK: hello(clientId)
  SK-->>UI: state connected
  UI->>UI: badge "Waiting for app"<br/>pairingUrl = ws(s)://pairingHost/ws/dglab?tid=clientId<br/>show deep link and QR code
  U->>P: scan QR code or open deep link
  P->>R: WebSocket upgrade /ws/dglab?tid=clientId
  R->>R: attachApp: tid known, fewer than 4 apps
  R-->>P: hello(appId), controller_attached
  R-->>SK: client_attached(appId)
  SK->>R: message: devices.get request
  R->>P: message (forwarded)
  P->>C: Bluetooth
  P-->>R: message: devices.get response
  R-->>SK: message (forwarded)
  SK->>SK: applySnapshot, start 30 s device refresh
  SK-->>CB: onDevicesChange
  CB-->>UI: badge "Paired", hide pairing box
  CB-->>UI: device card with Ch. A and Ch. B
  loop while the app is attached
    P-->>SK: slots.patch (limits, mute, status)
    SK-->>CB: device state changed → card update
  end
```

Next, the user assigns Ch. A and Ch. B to e-stim channels. See [Assign a device feature](assign-feature.md). The output itself is described in [haptics.md → Coyote output](../haptics.md).

## Pairing UI states

| Badge | Condition | What the UI shows |
| --- | --- | --- |
| Disconnected | not connected | host field, Connect button |
| Connecting | socket opening | pairing URL field |
| Waiting for app | relay said hello, no app attached | pairing URL, deep link, QR code |
| Paired | at least one app attached and a device snapshot was received | device cards |
| Error | socket closed unexpectedly | reconnect runs automatically |

The deep link opens the DG-Lab app directly (`pairingDeepLink`). The QR code uses the format the app scans (`pairingQrPayload`). Both wrap the same pairing URL.

## The relay's view of a controller

The controller id is derived from the auth token, so a reloaded tab gets the **same** id and the phone does not have to pair again. Without authentication the id comes from the client address instead.

```mermaid
stateDiagram-v2
  [*] --> Waiting: controller connects, hello
  Waiting --> Paired: app attaches with tid
  Paired --> Waiting: last app leaves
  Waiting --> Waiting: idle 5 min, close 4002, tab reconnects
  Waiting --> Detached: tab socket closes
  Paired --> Detached: tab socket closes (reload, backgrounded)
  Detached --> Paired: same id back within 5 min, apps re-announced
  Detached --> Waiting: same id back, no apps left
  Detached --> [*]: 5 min grace expires, apps closed 4000
```

The grace period exists because switching to the DG-Lab app on a phone often backgrounds the browser, and mobile browsers may close its WebSocket. The relay keeps the slot so the `tid` the user just scanned still works.

The idle timeout is sent as an `idle_timeout` frame, but the client does not handle it specially. It sees a closed socket and reconnects with backoff, so in practice the controller stays registered while the tab is open.

## Errors and limits

| Situation | Result |
| --- | --- |
| Controller without a valid cookie (auth enabled) | HTTP 401 at the upgrade |
| Path other than `/ws/dglab` | HTTP 404 at the upgrade |
| App with an unknown `tid` | closed with 4001 `controller_not_found` |
| A fifth app on one controller | closed with 4001 `too_many_clients` |
| A ninth controller | closed with 4002 `too_many_controllers` |
| Same id connects again (second tab, same login) | the old socket is closed with 4000 `replaced` and does not reconnect |
| Frame over 64 KiB | connection closed by `ws` |
| Controller socket drops | client reconnects after 1 s, 2 s, 4 s … up to 15 s |
| Every 30 s | relay sends `heartbeat` to all sockets; while paired, the client re-requests the device list |

## Debugging

- Set `localStorage['happy-dglab-debug'] = 'true'` in the browser to log every frame (`[dglab] <-` / `->`).
- Server-side relay logs use the `[dglab]` tag at debug level.
- A channel that stays silent is usually muted or has a limit of 0 in the DG-Lab app. The backend logs a one-time warning for both.

## Code map

| Step | Files |
| --- | --- |
| Pairing UI | `initDglab` in [src/client/index.ts](../../../src/client/index.ts) |
| Backend, pairing URL, output | [haptic/dglab/coyoteBackend.ts](../../../src/client/components/haptic/dglab/coyoteBackend.ts) |
| Socket, reconnect, device refresh | [haptic/dglab/v4/socket.ts](../../../src/client/components/haptic/dglab/v4/socket.ts) |
| Deep link, QR payload | [haptic/dglab/v4/pairing.ts](../../../src/client/components/haptic/dglab/v4/pairing.ts) |
| Carrier waveform | [haptic/dglab/waveform.ts](../../../src/client/components/haptic/dglab/waveform.ts) |
| Relay | [src/server/services/dglabRelay.ts](../../../src/server/services/dglabRelay.ts) |
| Upgrade wiring | `attachUpgradeHandlers` in [src/server/index.ts](../../../src/server/index.ts) |
| User docs | [docs/dg-lab.md](../../dg-lab.md) |
