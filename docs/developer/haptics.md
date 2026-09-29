[← Developer Guide](README.md)

# Haptics

This page covers everything between "a funscript file exists" and "a toy moves". All of it runs in the browser. The server only lists and serves funscript files. It does **not** interpolate or modify them.

## Concepts

```mermaid
erDiagram
  TRACK ||--o{ FUNSCRIPT : "has, by filename stem"
  FUNSCRIPT ||--|| CHANNEL : "defines"
  CHANNEL ||--o{ FEATURE : "is assigned to"
  DEVICE ||--|{ FEATURE : "exposes"
  BACKEND ||--o{ DEVICE : "owns"

  TRACK {
    string id "base64url of the path"
  }
  FUNSCRIPT {
    string filename "song.estim.nipples.funscript"
  }
  CHANNEL {
    string channelKey "estim:nipples or vibrator"
  }
  FEATURE {
    string id "unique per backend, see table"
    string kind "scalar, rotate, linear, estim"
  }
  DEVICE {
    string name "unique display name"
  }
  BACKEND {
    string type "Intiface or DG-Lab"
  }
```

- A **channel** is `{ type, sub? }` ([shared/haptics.ts](../../src/shared/haptics.ts)). `channelKey()` turns it into the string used as map key, DOM attribute and stored value.
- A **feature** is one actuator. The user assigns features to channel keys, and each backend stores these assignments per feature id in `localStorage`.
- The **kind** of the feature decides how it is driven, not the funscript type. A vibrator script can drive a stroker, and one toy's two motors can follow two different scripts.

| Backend | Feature id format | Kinds | Stored in `localStorage` |
| --- | --- | --- | --- |
| Intiface (`ButtplugClientManager`) | device name, kind, feature index joined by `#` | `scalar`, `rotate`, `linear` | `happy-feature-assignments`, `happy-device-strengths`, `happy-stroker-range` |
| DG-Lab (`CoyoteBackend`) | `dglab`, slot id, channel 0/1 joined by `#` | `estim` | `happy-dglab-assignments`, `happy-dglab-strengths`, `happy-dglab-frequency`, `happy-dglab-pairing-host` |

## Backend interface

Every transport implements `HapticBackend` ([backend.ts](../../src/client/components/haptic/backend.ts)). The UI and the sync loop only use this interface.

```mermaid
classDiagram
  direction LR
  class HapticBackend {
    <<interface>>
    +connectionState
    +devices
    +onStateChange(listener)
    +onDevicesChange(listener)
    +onAssignmentsChange(listener)
    +getFeatures(device)
    +setFeatureChannel(featureId, channel)
    +getFeatureChannel(featureId)
    +getDeviceStrength(name)
    +setDeviceStrength(name, value)
    +hasFeaturesFor(channel)
    +hasLinearFor(channel)
    +sendContinuous(channel, intensity)
    +sendLinear(channel, position, durationMs)
    +getBatteryLevel(device)
    +stopAll()
    +setLinearRange(min, max)
    +getCarrierFrequency(name) optional
    +getDeviceBadge(name) optional
    +getDeviceAlerts(name) optional
    +getFeatureDetails(featureId) optional
    +onDeviceStateChange(listener) optional
  }

  class ButtplugClientManager {
    -client: ButtplugClient
    +connect(address)
    +disconnect()
  }
  class CoyoteBackend {
    -socket: DglabV4Socket
    +connect()
    +disconnect()
    +pairingUrl
    +pairingHost
    +appCount
  }
  class HapticBackendRegistry {
    -backends: HapticBackend[]
    +add(backend)
  }
  class DglabV4Socket {
    +connect(url)
    +send(build)
    +refreshDevices()
    +targetId
    +devices
  }

  HapticBackend <|.. ButtplugClientManager
  HapticBackend <|.. CoyoteBackend
  HapticBackend <|.. HapticBackendRegistry
  HapticBackendRegistry o-- HapticBackend : fans out to
  CoyoteBackend *-- DglabV4Socket
  ButtplugClientManager ..> ButtplugClient : buttplug npm v5

  class FunscriptSync
  class DeviceAssignment
  class DeviceStatus
  FunscriptSync --> HapticBackend : one per backend
  DeviceAssignment --> HapticBackend : one per backend
  DeviceStatus --> HapticBackendRegistry
```

`HapticBackendRegistry` makes all backends look like one: devices are concatenated, the connection state is the "best" of all (`connected` > `connecting` > `error` > `disconnected`), per-device calls go to the owning backend, and per-channel calls fan out. Today only `DeviceStatus` and `stopAll()` on `pagehide` go through it. The sync engines and the device lists talk to their own backend directly.

## Funscript pipeline

```mermaid
flowchart LR
  subgraph server["Server, at scan time"]
    Files[("/media<br/>song.mp3<br/>song.vibrator.funscript<br/>song.estim.nipples.funscript")]
    Parse["parseFunscriptName()<br/>stem, type, sub"]
    Info["TrackInfo.funscripts[]<br/>filename, type, sub"]
    Ch["readFunscriptChapters()<br/>chapters only"]
    Files --> Parse --> Info
    Files --> Ch
  end

  subgraph client["Browser, per track"]
    Fetch["App.fetchTrackScripts()<br/>GET /api/funscript/:id/:file<br/>cached per track id"]
    Loaded["LoadedScript[]<br/>channel + raw Funscript"]
    VizPrep["Visualization<br/>prepareScript() per script"]
    SyncPrep["each FunscriptSync<br/>prepareScript() per script"]
    Fetch --> Loaded
    Loaded -- "browsed track" --> VizPrep
    Loaded -- "active track" --> SyncPrep
  end

  Info -- "GET /api/library" --> Fetch
```

`prepareScript(actions, method)` sorts the actions and precomputes one cubic polynomial per segment, so `positionAt(prepared, ms)` is a binary search plus a polynomial evaluation. The methods are:

| Method | Continuous output (vibrate, rotate, e-stim) | Linear output (stroker) |
| --- | --- | --- |
| `none` | holds each point until the next one | jumps to the point just reached, 50 ms move |
| `linear` (default) | straight line between points | moves to the next point, duration = time until it |
| `pchip` | smooth, overshoot-free curve | same as `linear` (the device interpolates the move itself) |

The method comes from `FUNSCRIPT_INTERPOLATION_METHOD` (server config). Changing it calls `setInterpolation()`, which re-prepares all loaded scripts.

## The sync loop

`FunscriptSync` ([funscriptSync.ts](../../src/client/components/funscriptSync.ts)) is a timer loop that reads the **active** player's time and writes to **one** backend. `App` creates one engine for Intiface and, if DG-Lab is enabled, a second one for the Coyote, so each can have its own delay.

```mermaid
stateDiagram-v2
  [*] --> Stopped
  Stopped --> Playing: active player unpaused<br/>start(): stopAll, tick
  Playing --> Stopped: active player paused<br/>pause(): stop timer, stopAll
  Playing --> Playing: tick every 1000/rate ms
  Playing --> Playing: seeking → resetScriptState
  Playing --> Playing: devices, assignments, delay,<br/>interpolation changed → resyncNow
  Playing --> Stopped: clearScripts (active track changed)
```

What one tick does:

```mermaid
flowchart TD
  T(["tick()"]) --> Time["t = activeStore.currentTime × 1000 + delayMs<br/>clamped to [0, duration]"]
  Time --> Loop{{"for each loaded script"}}
  Loop --> Has{"backend.hasFeaturesFor(channel)?"}
  Has -- no --> Next["next script"]
  Has -- yes --> Pos["pos = positionAt(prepared, t)<br/>null outside the script → 0"]
  Pos --> Cont["backend.sendContinuous(channel, pos / 100)"]
  Cont --> Lin{"backend.hasLinearFor(channel)?"}
  Lin -- no --> Next
  Lin -- yes --> Locked{"previous move still running?<br/>now < moveLockedUntil"}
  Locked -- yes --> Next
  Locked -- no --> WP["nextStrokerWaypoint(t)"]
  WP --> SamePos{"same position as last sent?"}
  SamePos -- yes --> Next
  SamePos -- no --> SendLin["backend.sendLinear(channel, pos, durationMs)<br/>moveLockedUntil = now + durationMs"]
  SendLin --> Next
  Next --> Loop
  Loop -- done --> Sched["setTimeout(tick, 1000 / rate)"]
```

Continuous output is sent **every tick**, even if the value did not change. The backends deduplicate, and resending makes the output self-correcting: if one Bluetooth write is lost, the next tick fixes it. The update rate slider (10–240 Hz, default from `HAPTIC_FREQUENCY`) sets the tick interval for all engines.

## Backend output paths

### Intiface

```mermaid
flowchart LR
  SC["sendContinuous(channel, 0..1)"] --> Res["resolve(channel)<br/>assigned, supported features"]
  Res --> Kind{"kind"}
  Kind -- scalar --> Sc["value × device strength"]
  Kind -- rotate --> Rot["positionToRotate()<br/>speed tier + direction"]
  Kind -- linear --> Skip["skipped here"]
  Sc & Rot --> Gap{"within device<br/>messageTimingGap?"}
  Gap -- yes --> Drop["drop"]
  Gap -- no --> Dedup{"same step value<br/>as last time?"}
  Dedup -- yes --> Drop
  Dedup -- no --> Run["feature.runOutput(<br/>DeviceOutputCommand.createPercent)"]

  SL["sendLinear(channel, pos, ms)"] --> Scale["rescale pos into<br/>stroker min/max range"]
  Scale --> Clamp["clamp duration to the<br/>device's durationRange"]
  Clamp --> RunL["runOutput(HwPositionWithDuration)"]
```

### DG-Lab Coyote

The Coyote has no position or speed. It emits pulses: a carrier waveform whose strength can be set. HAPPY keeps a flat carrier queued and uses the funscript to drive the channel **strength**. The DG-Lab app owns the safety limits, and HAPPY never asks for more than the ceiling the app reports.

```mermaid
flowchart LR
  SC["sendContinuous(channel, 0..1)"] --> Res["resolve(channel)<br/>assigned slot + channel A/B"]
  Res --> Usable{"channel status OK?<br/>not no-circuit, damaged, masked"}
  Usable -- no --> Zero["value = 0"]
  Usable -- yes --> Map["value = round(pos × strength × intensityMax)<br/>mapIntensity()"]
  Zero & Map --> Str{"pushStrength<br/>changed and ≥100 ms since last,<br/>or unchanged and ≥150 ms"}
  Str -- send --> ST["SetTempIntensity(value, 300 ms)<br/>expires by itself: dead-man switch"]
  Map --> Pos{"value > 0?"}
  Pos -- yes --> Car{"≥800 ms since last carrier?"}
  Car -- yes --> AP["AppendPulseData<br/>10 flat frames at the chosen frequency,<br/>im: true replaces the queue"]
```

`stopAll()` sends `device.op.clear` and resets both channel intensities to 0. All messages go through `DglabV4Socket.send()` to the relay, which forwards them to every attached app. See [Pair a DG-Lab Coyote](use-cases/coyote-pairing.md) for the connection side.

## Safety behaviour

| Situation | What stops the output |
| --- | --- |
| Pause | `FunscriptSync.pause()` → `backend.stopAll()` |
| Track changes | `clearScripts()` → `stop()` → `stopAll()` |
| Devices or assignments change | `resyncNow()` → `stopAll()` and immediately resend the current values |
| Tab closed or navigated away | `pagehide` → `HapticBackendRegistry.stopAll()` |
| Tab crashes or network drops (Coyote) | every strength command expires after 300 ms |
| Script has no point at the current time | `positionAt()` returns null → 0 is sent |

## Code map

| Topic | Files |
| --- | --- |
| Channel model | [shared/haptics.ts](../../src/shared/haptics.ts), [shared/types.ts](../../src/shared/types.ts) |
| Interpolation | [shared/interpolation.ts](../../src/shared/interpolation.ts) |
| Sync loop | [components/funscriptSync.ts](../../src/client/components/funscriptSync.ts) |
| Interface and registry | [haptic/backend.ts](../../src/client/components/haptic/backend.ts), [haptic/backendRegistry.ts](../../src/client/components/haptic/backendRegistry.ts) |
| Intiface | [haptic/buttplugClient.ts](../../src/client/components/haptic/buttplugClient.ts) |
| DG-Lab | [dglab/coyoteBackend.ts](../../src/client/components/haptic/dglab/coyoteBackend.ts), [dglab/waveform.ts](../../src/client/components/haptic/dglab/waveform.ts), [dglab/v4/protocol.ts](../../src/client/components/haptic/dglab/v4/protocol.ts), [dglab/v4/socket.ts](../../src/client/components/haptic/dglab/v4/socket.ts) |
| Device UI | [haptic/deviceAssignment.ts](../../src/client/components/haptic/deviceAssignment.ts), [haptic/deviceStatus.ts](../../src/client/components/haptic/deviceStatus.ts), [haptic/templates.ts](../../src/client/components/haptic/templates.ts) |
| Timelines | [haptic/visualization/index.ts](../../src/client/components/haptic/visualization/index.ts), [haptic/visualization/geometry.ts](../../src/client/components/haptic/visualization/geometry.ts) |
