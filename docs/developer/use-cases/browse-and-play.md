[← Developer Guide](../README.md)

# Use case: Browse and play a track

**Goal:** the user opens a track from an album, presses play and their toy follows the funscript. Then they browse to another track while the first keeps playing, and finally the album continues with the next track automatically.

For the background, read [client.md → two-player model](../client.md#the-two-player-model) first.

## 1. Open a track page

Browsing never touches what is currently playing. The new track loads **paused** into the slot that is not active.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as App
  participant PC as PlaybackController
  participant PS as PlaybackSession
  participant V as Visualization
  participant J as Jellyfin + HAPPY plugin

  U->>A: click a track in the album view
  A->>A: openTrack(id, pushState, source = album)
  A->>A: history.pushState(?view=player&id=…)
  A->>PC: browse(id, source)
  PC->>PC: toRequest(track): streamUrl, cover URL,<br/>chaptersVttUrl / storyboardVttUrl (blob:), parseVrFormat
  PC->>PS: browse(request)
  PS->>PS: not the active track → load into the other slot (paused)
  PS-->>PC: onChange
  A->>A: loadTrackAssets(track)
  A->>J: GET /Happy/Items/{id}/Funscripts/{key} (once per file, cached)
  J-->>A: raw funscript JSON
  A->>V: mount(container, scripts)
  V->>V: prepareScript() per script, draw timelines
  opt funscripts carry metadata.chapters
    A->>PS: updateChapters(id, chapters, blob URL)<br/>per CHAPTER_SOURCE_PRIORITY
  end
  A->>A: publishChannels → DeviceStatus, DeviceAssignment
  A->>A: renderTrackDescription(track.description)
  Note over PS: The media element itself streams<br/>/Videos|Audio/{id}/stream?static=true&ApiKey=…<br/>from Jellyfin with range requests (CORS mode)
```

## 2. Press play

Playing is what makes a slot **active**, and becoming active is what makes haptics follow it.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant P as video-player (focused slot)
  participant PS as PlaybackSession
  participant PC as PlaybackController
  participant A as App
  participant FS as FunscriptSync (per backend)
  participant BE as Backend

  U->>P: play
  P->>PS: store update: paused false
  PS->>PS: promote(slot): pause the old active slot, swap roles
  PS-->>FS: onChange: active slot playing → start()
  PS-->>PC: onChange
  PC->>PC: active id changed → queue.load(album tracks, id)
  PC-->>A: onActiveTrack(track)
  A->>FS: clearScripts() → stop(), stopAll
  A->>A: set navigator.mediaSession metadata
  A->>A: await fetchTrackScripts(track) (cache hit)
  A->>FS: loadScripts(scripts) → prepareScript
  A->>FS: resyncNow() (no-op while stopped)
  PS-->>FS: next store update (timeupdate) → start()
  FS->>BE: stopAll(), then tick
  loop every 1000 / rate ms while playing
    FS->>FS: t = currentTime (extrapolated) + delay
    FS->>BE: sendContinuous / sendLinear
  end
```

Session listeners run in registration order. The Intiface `FunscriptSync` subscribes before `PlaybackController`, so when switching from one playing track to another it may start with the **previous** track's scripts until `onActiveTrackChanged` clears them. The engine then restarts on the next store update. Keep this in mind when you change the wiring.

## 3. Browse elsewhere while it plays

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as App
  participant PS as PlaybackSession
  participant F as Footer
  participant FS as FunscriptSync

  U->>A: open track B
  A->>PS: browse(B)
  PS->>PS: B loads paused in the idle slot, becomes focused
  PS-->>F: onChange: focusedIsActive = false → footer shows track A
  Note over FS: still follows the active slot (A), nothing changes
  U->>A: back to track A
  A->>PS: browse(A)
  PS->>PS: A is active → focus the active slot, no reload
  PS-->>F: focusedIsActive = true → footer hides
```

## 4. Track ends, next one starts

```mermaid
sequenceDiagram
  autonumber
  participant PS as PlaybackSession
  participant PC as PlaybackController
  participant Q as PlaybackQueue
  participant A as App
  participant FS as FunscriptSync

  PS-->>PC: onChange: activeStore.ended = true
  PC->>PC: ended edge detected, autoplay on
  PC->>Q: hasNext?
  alt next track in queue
    PC->>Q: step(1)
    PC->>PS: start(next): load into the active slot, play
    PS-->>PC: onChange: active id changed
    PC-->>A: onActiveTrack(next)
    A->>FS: clearScripts, loadScripts(next), resyncNow
    A->>A: if a track page is open: openTrack(next)
  else end of queue, repeat all
    PC->>Q: restart()
    PC->>PS: start(first)
  else end of queue
    Note over PC: stop
  end
```

Repeat-one does not go through the controller at all: it sets `loop` on the media element (`PlaybackSession.setLoop`).

## Code map

| Step | Files |
| --- | --- |
| Track page, asset loading | `openTrack`, `loadTrackAssets`, `fetchTrackScripts`, `applyFunscriptChapters`, `onActiveTrackChanged` in [src/client/index.ts](../../../src/client/index.ts) |
| URLs and WebVTT | [src/client/api.ts](../../../src/client/api.ts), [jellyfin/urls.ts](../../../src/client/jellyfin/urls.ts) |
| Slots and handoff | [player/session.ts](../../../src/client/components/player/session.ts) |
| Queue and autoplay | [player/controller.ts](../../../src/client/components/player/controller.ts), [player/queue.ts](../../../src/client/components/player/queue.ts) |
| Footer | [player/footer.ts](../../../src/client/components/player/footer.ts) |
| Timelines | [haptic/visualization/index.ts](../../../src/client/components/haptic/visualization/index.ts) |
| Device output | [funscriptSync.ts](../../../src/client/components/funscriptSync.ts), [haptics.md](../haptics.md) |
