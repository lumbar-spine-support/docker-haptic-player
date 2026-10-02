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
| DG-Lab (`CoyoteBackend`) | `dglab`, slot id, channel 0/1 joined by `#` | `estim` | `happy-dglab-assignments`, `happy-dglab-strengths`, `happy-dglab-pulse-rate`, `happy-dglab-pulse-width`, `happy-dglab-pairing-host` |

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
    +getPulseWidth(name) optional
    +getDeviceBadge(name) optional
    +getDeviceAlerts(name) optional
    +getFeatureDetails(featureId) optional
    +getChannelHealth(channel) optional
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
    -kit: DglabSocket
    +connect(url)
    +setTempIntensity()
    +appendPulse()
    +resetIntensity()
    +clear()
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

### Channel status badges

`DeviceStatus` asks the registry for `getChannelHealth(channel)`: `total` assigned actuators, how many are `usable`, and the `DeviceAlert`s for them. The registry sums connected backends only; a backend without the method (Intiface) counts `hasFeaturesFor()` as 1/1 with no alerts. `CoyoteBackend` reports a `danger` alert (not usable) when the slot has no hardware (`hasDevice: false`) or the channel status is no circuit / damaged / masked, and a `warning` when the channel is muted or has no `intensityMax`.

| Badge | Condition |
| --- | --- |
| Disconnected (grey) | `total === 0` |
| Error (red) | `usable === 0` |
| Warning (yellow) | any alert |
| Connected (green) | otherwise |

`describeChannel()` maps health to label and popover text. The popover is Bootstrap's, taken from the globally loaded bundle (`window.bootstrap`, typed in `src/client/types/bootstrap.d.ts`) with `trigger: 'focus'`, so it closes on the next click. Its text is plain (`html: false`); popovers of badges removed by a track change are disposed on the next refresh.

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
  Car -- yes --> AP["AppendPulseData<br/>10 flat frames at the chosen pulse rate and width,<br/>im: true replaces the queue"]
```

#### Pulse frames

The V4 protocol carries Coyote 3.0 pulse frames unchanged (`ver: 3`), so the [Coyote V3 Bluetooth protocol](https://github.com/dungeonlab-open/dglab-bluetooth-protocol/blob/main/coyote/v3/README.md) and its [waveform explanation](https://github.com/dungeonlab-open/dglab-bluetooth-protocol/blob/main/coyote/README.md) define the format. A frame is 16 hex characters covering 100 ms: four 25 ms steps, each with a period byte and a pulse width byte.

| Byte | Range | Meaning | HAPPY setting |
| --- | --- | --- | --- |
| Period ("waveform frequency") | 10–240 | Pulse period in ms. 10–100 is literal; 101–1000 ms is compressed into 101–240. Out of range drops all four steps. | Pulse Frequency, 10–100 Hz (default 50), sent as `round(1000 / Hz)` |
| Waveform intensity | 0–100 | Relative pulse width. The pulse voltage comes from the channel strength. | Pulse Width, 10–100 % (default 100) |

`waveform.ts` keeps both values constant across the frame. The funscript only drives channel strength.

`stopAll()` sends `device.op.clear` and resets both channel intensities to 0. See [Pair a DG-Lab Coyote](use-cases/coyote-pairing.md) for the connection side.

#### DG-Lab client

The wire protocol, device cache and patch merging come from [dglab-kit](https://github.com/dungeonlab-open/dglab-kit) (`DglabSocket`). Protocol types (`V4Channel`, `V4ActionType`, `V4DeviceInfo`, …) are imported from the kit directly; `Device` is `V4DeviceInfo` plus the app's untyped slot `id`. `DglabV4Socket` wraps it and adds what the kit leaves to the caller:

- Reconnects with backoff (1 s doubling to 15 s), except after the relay closes with `replaced` (another tab took over).
- Requests devices when an app attaches and every 30 s, since battery level only arrives with a full snapshot.
- Sends each operation only to the app that owns the slot.
- Sets `p: 1`, `im: true` and `ver: 3` explicitly; the kit leaves them out by default.
- Fire-and-forget: every operation's promise is caught. Timeouts and disconnects are ignored, and other errors are logged once per kind.
- Tracing via `localStorage['happy-log'] = 'dglab=debug'` or `LOG_LEVEL=debug` on the server, including `custom.action` events. Client code logs through `createLogger(namespace)` in `src/client/utils/logger.ts`; levels are set per namespace with `setLogLevel()` or the `happy-log` override.

## Safety behaviour

| Situation | What stops the output |
| --- | --- |
| Pause | `FunscriptSync.pause()` → `backend.stopAll()` |
| Track changes | `clearScripts()` → `stop()` → `stopAll()` |
| Devices or assignments change | `resyncNow()` → `stopAll()` and immediately resend the current values |
| Tab closed or navigated away | `pagehide` → `HapticBackendRegistry.stopAll()` |
| Tab crashes or network drops (Coyote) | every strength command expires after 300 ms |
| Script has no point at the current time | `positionAt()` returns null → 0 is sent |

## Possible e-stim improvements

Ideas for Coyote playback, taken from the [Restim stim theory wiki](https://github.com/diglet48/restim/wiki). None is implemented yet. Each one should be tried on real hardware before it becomes a default.

| Idea | Theory | Sketch | Caveat |
| --- | --- | --- | --- |
| Perceptual intensity curve | Perceived intensity grows as $M = \alpha I^{\beta}$ with $\beta \approx 1.5$–2.5 ([nerve activation](https://github.com/diglet48/restim/wiki/nerve-activation)). A linear mapping makes the lower half of a script feel almost empty. | In `mapIntensity()`: $out = floor + (1 - floor) \cdot pos^{\gamma}$ for $pos > 0$, with $\gamma \approx 0.5$ and a floor of about 15–25 %. Both per device. | The floor must stay below the ceiling the app reports. Position 0 must still send 0. |
| Onset ramp | A sudden jump in strength causes an onset spike that can hurt ([volume ramp](https://github.com/diglet48/restim/wiki/volume-ramp)). | Limit how fast strength can rise per update, and ramp up over a few seconds after play or seek. Decreases stay immediate. | The DG-Lab app has its own soft-start. Both together must not make fast scripts feel mushy. |
| Random pulse spacing | Randomising the gap between pulses (5–10 ms) slows numbing and softens sudden changes ([pulse rate](https://github.com/diglet48/restim/wiki/pulse-rate)). | Vary the period byte by about ±20 % per 25 ms step in `flatFrame()`. Opt-in. | DG-Lab says periods longer than 25 ms, or periods that change between steps, are processed in an undocumented way. Only predictable at 40 Hz and above. |
| A/B position mode | Moving the sensation between electrodes; the Coyote can do the two simplest three-phase patterns ([three-phase effects](https://github.com/diglet48/restim/wiki/threephase-effects)). | Drive channel A with $f(pos)$ and channel B with $f(1 - pos)$ from one `estim` script. | Needs a new assignment option. It only makes sense when both channels share an electrode area. |
| Narrow pulses by default | Narrow pulses at higher voltage reach the same nerve activation with less charge and less heating ([nerve activation](https://github.com/diglet48/restim/wiki/nerve-activation), [safety](https://github.com/diglet48/restim/wiki/estim-safety)). | Once the Pulse Width setting has been tested, consider a lower default. | A narrower pulse needs a higher strength, which the app caps. Users would have to raise their comfort limit. |
| Safety docs | One isolated channel per nipple. Keep electrodes below the waist otherwise ([safety](https://github.com/diglet48/restim/wiki/estim-safety)). | Add a note to the user docs for `estim:nipples`. | — |

## Code map

| Topic | Files |
| --- | --- |
| Channel model | [shared/haptics.ts](../../src/shared/haptics.ts), [shared/types.ts](../../src/shared/types.ts) |
| Interpolation | [shared/interpolation.ts](../../src/shared/interpolation.ts) |
| Sync loop | [components/funscriptSync.ts](../../src/client/components/funscriptSync.ts) |
| Interface and registry | [haptic/backend.ts](../../src/client/components/haptic/backend.ts), [haptic/backendRegistry.ts](../../src/client/components/haptic/backendRegistry.ts) |
| Intiface | [haptic/buttplugClient.ts](../../src/client/components/haptic/buttplugClient.ts) |
| DG-Lab | [dglab/index.ts](../../src/client/components/haptic/dglab/index.ts) (debug tracing), [dglab/coyoteBackend.ts](../../src/client/components/haptic/dglab/coyoteBackend.ts), [dglab/waveform.ts](../../src/client/components/haptic/dglab/waveform.ts), [dglab/v4/pairing.ts](../../src/client/components/haptic/dglab/v4/pairing.ts), [dglab/v4/socket.ts](../../src/client/components/haptic/dglab/v4/socket.ts) |
| Device UI | [haptic/deviceAssignment.ts](../../src/client/components/haptic/deviceAssignment.ts), [haptic/deviceStatus.ts](../../src/client/components/haptic/deviceStatus.ts), [haptic/templates.ts](../../src/client/components/haptic/templates.ts) |
| Timelines | [haptic/visualization/index.ts](../../src/client/components/haptic/visualization/index.ts), [haptic/visualization/geometry.ts](../../src/client/components/haptic/visualization/geometry.ts) |
