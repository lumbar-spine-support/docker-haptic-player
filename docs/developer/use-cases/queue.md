[← Developer Guide](../README.md)

# Use case: Queue and save as a playlist

**Goal:** the user starts an album, adds a video from the library, reorders what is up next in the player and saves the queue as a Jellyfin playlist.

The rules the queue follows are in [ARCHITECTURE.md](../../../ARCHITECTURE.md#playback-queue). In short: only `PlaybackController` changes `PlaybackQueue`; albums and playlists seed it, everything after that edits it.

## 1. An album seeds the queue

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant D as DetailView
  participant A as App
  participant PC as PlaybackController
  participant Q as PlaybackQueue
  participant PS as PlaybackSession

  U->>D: Play (or Shuffle) on the album page
  D->>A: playCollection(source, shuffle)
  A->>PC: playCollection(source, { shuffle })
  PC->>Q: replace(album track ids, 0, source)
  Q-->>PC: onChange → skip buttons, queue UI
  PC->>PS: start(first track)
  A->>A: openTrack(first track): its page opens on the active slot
```

Pressing play on a file page works the same way through `PlaybackController.onSessionChange()`: the page remembers where it was opened from (`browse(id, source, index)`), and `applyStart()` either loads that album/playlist at the row's index or, for a file opened on its own, calls `PlaybackQueue.playNow()` so the rest of the queue stays.

## 2. Add from the library

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant M as queue menu (card / row)
  participant A as App
  participant PC as PlaybackController
  participant Q as PlaybackQueue
  participant UI as queue panel

  U->>M: ⋯ → Add to queue
  M->>A: QueueActions.enqueue([id])
  A->>PC: enqueue([id])
  PC->>Q: append (ids the library does not know are dropped)
  Q-->>UI: onChange → notifyQueueChanged()
  A->>A: showToast("… added to queue · n up next")
```

"Play next" is the same with `insertNext()`. Adding happens only in the library; the player has no add button. Playlists with `PlaylistInfo.canDelete` (Jellyfin's `CanDelete`, requested with `Fields=CanDelete`) also get "Delete playlist": `App.deletePlaylist()` confirms, calls `DELETE /Items/{id}` (`jellyfin/playlists.ts`), drops it from `Library` and tells the queue panel, which then no longer names it as the source. A refused delete (401/403) only shows a toast.

## 3. Reorder in the player

The queue button and `<media-queue-panel>` are part of the Video.js skin, so every player slot has them; the panel opens in a `media-popover` inside the player (so it works in fullscreen; `boundary="viewport"` lets it grow past a small player) and closes itself when its player is hidden. It opens scrolled so the playing entry is on top, with up to ten played entries above it.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant P as media-queue-panel
  participant T as QueueTarget (player/queueTarget.ts)
  participant PC as PlaybackController
  participant Q as PlaybackQueue

  U->>P: drag an entry by its handle (or Alt+↑/↓)
  P->>P: the row follows the pointer (transform), the rows it passes slide aside;<br/>nothing leaves the DOM, so pointer capture holds; no re-render while dragging
  U->>P: release
  P->>T: moveUpcoming(from, to)
  T->>PC: moveUpcoming(from, to)
  PC->>Q: moveUpcoming(from, to) → edited = true
  Q-->>P: onChange → render from getState()
```

After any change the panel re-renders and animates rows from their old position (FLIP: measure, rebuild, translate back, transition to zero), so a shuffle or removal is easy to follow.

Clicking an entry calls `jumpTo(uid)`: entries are addressed by `uid`, never by track id, so a track queued twice is unambiguous.

## 4. Save as a playlist

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant P as media-queue-panel
  participant A as App.saveQueue
  participant API as api.ts
  participant J as Jellyfin
  participant L as Library
  participant Q as PlaybackQueue

  alt Save as playlist…
    U->>P: name, Save
    P->>A: save({ mode: 'new', name })
    A->>API: createJellyfinPlaylist(name, queue.trackIds)
    API->>J: POST /Playlists { Name, Ids, UserId, IsPublic: false }
  else Save to "…" (queue came from a playlist, edited)
    U->>P: Save to "…"
    P->>A: save({ mode: 'overwrite' })
    A->>API: overwriteJellyfinPlaylist(playlist, queue.trackIds)
    API->>J: GET /Playlists/{id} (ItemIds) + GET /Playlists/{id}/Users/{me} (CanEdit)
    Note over API,J: refused unless CanEdit and ItemIds equal the entries HAPPY loaded
    API->>J: POST /Playlists/{id} { Ids }
  end
  API->>J: GET /Items/{id}, GET /Playlists/{id}/Items
  API-->>A: PlaylistInfo (mapped like the library loader)
  A->>L: upsertPlaylist(): the card appears without a reload
  A->>Q: markSaved({ type: 'playlist', id }) → edited = false
  A-->>P: "Saved …" (or the reason it was not saved)
```

Saves always send the full, ordered list. Jellyfin's `Move` and `DELETE /Playlists/{id}/Items?entryIds=` address entries by an id two copies of the same item share, so incremental edits could hit the wrong copy.

## Code map

| Step | Files |
| --- | --- |
| Queue model and rules | [player/queue.ts](../../../src/client/components/player/queue.ts), [player/controller.ts](../../../src/client/components/player/controller.ts) |
| Player UI | [videojs/features/queue.ts](../../../@/components/videojs/features/queue.ts), [videojs/ui/queue.ts](../../../@/components/videojs/ui/queue.ts), [player/queueTarget.ts](../../../src/client/components/player/queueTarget.ts), [videojs/video/skin.html](../../../@/components/videojs/video/skin.html) |
| Library entry points | [components/library/queueMenu.ts](../../../src/client/components/library/queueMenu.ts), [components/library/detail.ts](../../../src/client/components/library/detail.ts), [utils/toast.ts](../../../src/client/utils/toast.ts), [index.ts](../../../src/client/index.ts) |
| Saving | [jellyfin/playlists.ts](../../../src/client/jellyfin/playlists.ts), [api.ts](../../../src/client/api.ts), [index.ts](../../../src/client/index.ts) |
| Tests | [test/client/queue.test.ts](../../../test/client/queue.test.ts), [test/client/controller.test.ts](../../../test/client/controller.test.ts), [test/client/queueTarget.test.ts](../../../test/client/queueTarget.test.ts), [test/integration/jellyfin/playlists.test.ts](../../../test/integration/jellyfin/playlists.test.ts) |
