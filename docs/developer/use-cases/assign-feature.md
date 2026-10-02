[← Developer Guide](../README.md)

# Use case: Assign a device feature to a channel

**Goal:** the user decides which part of which toy follows which funscript. For example, a vibrator follows the `vibrator` script, a stroker follows `stroker`, and Coyote channel A follows `estim:nipples`.

Precondition: a backend is connected and has at least one device. See [Connect Intiface](intiface-pairing.md) or [Pair a DG-Lab Coyote](coyote-pairing.md).

## The device card

Each backend has its own `DeviceAssignment` instance that renders one card per device.

```mermaid
flowchart TB
  Card["Device card<br/>name, badge, battery"] --> Ctrl["Controls"]
  Card --> Feats["One row per feature"]
  Ctrl --> Str["Strength slider<br/>if any feature is not linear"]
  Ctrl --> Freq["Pulse frequency slider<br/>only if the backend has getCarrierFrequency (Coyote)"]
  Ctrl --> Rng["Position limits<br/>if any feature is linear"]
  Feats --> Sel["Channel dropdown<br/>'— Assign Script —' + channels"]
  Feats --> Det["Detail panel<br/>value, limits, step count<br/>refreshed every 250 ms while open"]
  Feats --> Uns["Unsupported feature<br/>dropdown disabled, '— Not Supported —'"]
```

The dropdown offers the base types (`FUNSCRIPT_TYPES`: `stroker`, `buttplug`, `vibrator`, `estim`, `machine`, `unknown`) plus every sub channel the **current track** has. A file `song.estim.nipples.funscript` becomes the channel key `estim:nipples`, shown as "E-Stim — Nipples". The sub channels come from `App.publishChannels()`, which runs on every track change.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant DA as DeviceAssignment
  participant BE as Backend<br/>Buttplug or Coyote
  participant LS as localStorage
  participant FS as FunscriptSync (same backend)
  participant DS as DeviceStatus

  U->>DA: pick "Vibrator" for a feature of a Lovense toy
  DA->>BE: setFeatureChannel(featureId, parseChannelKey("vibrator"))
  BE->>BE: update featureAssignments, clear channel cache
  BE->>LS: persist()
  BE-->>DA: onAssignmentsChange → render()
  BE-->>FS: onAssignmentsChange → resyncNow()
  FS->>BE: if playing: stopAll(), then send current positions again
  BE-->>DS: onAssignmentsChange → update the status badges
```

Strength, pulse settings and position limits skip the event: the backend stores the value and uses it on the next command it sends.

## What is stored where

| Setting | Scope | localStorage key |
| --- | --- | --- |
| Intiface feature → channel | per feature id `deviceName#kind#index` | `happy-feature-assignments` |
| Intiface strength | per device name | `happy-device-strengths` |
| Intiface position limits | per device name (defaults to 0–100 %) | `happy-stroker-ranges` |
| Coyote channel → funscript channel | per feature id (Ch. A / Ch. B of one Coyote) | `happy-dglab-assignments` |
| Coyote strength | per Coyote (both channels) | `happy-dglab-strengths` |
| Coyote pulse frequency (Hz) | per Coyote (both channels) | `happy-dglab-pulse-rate` |

## How assignments are used at playback

```mermaid
flowchart LR
  Script["Loaded script<br/>channel vibrator"] --> Res["backend.resolve(channel)<br/>features assigned to vibrator"]
  Res --> Kind{"feature kind"}
  Kind -- scalar / rotate --> Cont["sendContinuous<br/>× device strength"]
  Kind -- linear --> Lin["sendLinear<br/>rescaled into position limits"]
  Res -- none --> Skip["script ignored for this backend"]
```

A script whose channel has no assigned feature is simply ignored. A sub channel like `estim:nipples` matches only features assigned to exactly that key, not features assigned to plain `estim`.

## Code map

| Step | Files |
| --- | --- |
| Card, sliders, dropdown | [haptic/deviceAssignment.ts](../../../src/client/components/haptic/deviceAssignment.ts), [haptic/templates.ts](../../../src/client/components/haptic/templates.ts) |
| Channel keys and labels | [src/shared/haptics.ts](../../../src/shared/haptics.ts) |
| Intiface storage and output | [haptic/buttplugClient.ts](../../../src/client/components/haptic/buttplugClient.ts) |
| Coyote storage and output | [haptic/dglab/coyoteBackend.ts](../../../src/client/components/haptic/dglab/coyoteBackend.ts) |
| Status badges | [haptic/deviceStatus.ts](../../../src/client/components/haptic/deviceStatus.ts) |
| Channel publishing | `publishChannels` in [src/client/index.ts](../../../src/client/index.ts) |
