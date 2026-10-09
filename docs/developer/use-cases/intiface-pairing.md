[← Developer Guide](../README.md)

# Use case: Connect Intiface and a toy

**Goal:** the user connects HAPPY to Intiface Central so their Bluetooth toy shows up in the settings panel.

HAPPY does not pair Bluetooth devices itself. Intiface Central does that, and the browser connects to Intiface over a WebSocket using the [buttplug](https://github.com/buttplugio/buttplug-js) library (v5). Neither Jellyfin nor the HAPPY plugin is involved.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as Settings panel<br/>bindIntifaceSettings
  participant BM as ButtplugClientManager
  participant BC as ButtplugClient<br/>buttplug npm
  participant IC as Intiface Central
  participant T as Toy

  U->>IC: start server, put toy in pairing mode
  IC->>T: BLE scan and connect
  U->>UI: pick ws:// or wss://, enter host:port, press Connect
  UI->>UI: parseIntifaceAddress() → scheme + host<br/>save happy-intiface-address
  UI->>BM: connect(address)
  BM->>BM: state = connecting
  BM->>BC: new ButtplugClient('AudioHapticPlayer')<br/>listen: deviceadded, deviceremoved, disconnect
  BM->>BC: connect(ButtplugBrowserWebsocketClientConnector)
  BC->>IC: WebSocket handshake
  IC-->>BC: server info + device list
  BM->>BM: state = connected
  BM-->>UI: onStateChange → badge "Connected", button "Disconnect"
  BM->>BC: startScanning()
  BC-->>BM: deviceadded(device)
  BM->>BM: onDeviceChanged: invalidate caches
  BM-->>UI: onDevicesChange
  UI->>BM: getFeatures(device) → buildFeatures()<br/>one DeviceFeature per output
  UI->>BM: getBatteryLevel(device)
  UI-->>U: device card with one dropdown per actuator
```

After this the user assigns the actuators to channels. See [Assign a device feature](assign-feature.md).

## Connection states

```mermaid
stateDiagram-v2
  [*] --> disconnected
  disconnected --> connecting: Connect clicked
  connecting --> connected: handshake OK
  connecting --> error: Intiface not reachable
  error --> connecting: Connect clicked again
  connected --> disconnected: Disconnect clicked
  connected --> disconnected: Intiface closed the socket
  note right of error
    Alert: check host:port
    and that the server runs
  end note
  note right of connected
    Warning while
    no devices are paired
  end note
```

There is **no automatic reconnect** and no auto-connect on page load. The user presses Connect each time. Leaving `connected` clears all device caches and the last sent values.

## How a Buttplug device becomes features

```mermaid
flowchart LR
  Dev["ButtplugClientDevice"] --> Feat["device.features[]"]
  Feat --> Out["feature.outputs[]"]
  Out --> Kind{"OutputType"}
  Kind -- Rotate --> R["kind: rotate"]
  Kind -- HwPositionWithDuration --> L["kind: linear<br/>label: Stroker"]
  Kind -- Position --> X["ignored<br/>no duration"]
  Kind -- "Vibrate, Oscillate,<br/>Constrict, Inflate, …" --> S["kind: scalar"]
  Kind -- "Temperature, Led, Spray" --> U["kind: scalar<br/>unsupported = true<br/>shown but not assignable"]
```

## Things to know

- The address must be reachable **from the browser**. `localhost` works only if Intiface runs on the same machine as the browser.
- `parseIntifaceAddress()` takes the scheme from the dropdown (default `ws://`) unless the host field itself starts with `ws://` or `wss://`. Browsers accept `ws://localhost` from an `https://` page, but block other `ws://` hosts as mixed content; use `wss://` (e.g. Intiface behind a TLS proxy) in that case.
- Assignments are keyed by device name, so the same toy keeps its assignments across reconnects and page reloads. Two toys with the same name share them.

## Code map

| Step | Files |
| --- | --- |
| Address input, Connect button, alerts | [settings/intiface.ts](../../../src/client/components/settings/intiface.ts), [utils/intifaceAddress.ts](../../../src/client/utils/intifaceAddress.ts) |
| Connection, features, output | [haptic/buttplugClient.ts](../../../src/client/components/haptic/buttplugClient.ts) |
| Device cards | [haptic/deviceAssignment.ts](../../../src/client/components/haptic/deviceAssignment.ts), [haptic/templates.ts](../../../src/client/components/haptic/templates.ts) |
| User docs | [docs/intiface.md](../../intiface.md) |
