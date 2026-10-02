[← Developer Guide](../README.md)

# Use case: Scan the library

**Goal:** the user drops new files into the media folder and sees them in HAPPY without restarting the container.

There is no file watcher. The library is checked lazily, when a client asks for it.

## Timeline

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant R as routes/library.ts
  participant I as libraryIndex
  participant S as libraryService
  participant FF as ffprobe
  participant C as /config/cache

  Note over I: Server start: createApp() calls libraryIndex.get() in the background
  I->>I: fingerprint(): stat every file
  I->>C: read library.json
  alt cache valid
    C-->>I: snapshot, no ffprobe needed
  else first start or files changed
    I->>S: buildLibrary(config)
    loop every audio/video file
      S->>FF: probeMedia(file)
      FF-->>S: tags, duration, chapters, has cover
    end
    S-->>I: LibraryResponse
    I->>C: write library.json (tmp + rename)
    I->>C: prune covers of deleted files
  end

  B->>R: GET /api/library
  R->>I: get()
  I-->>R: snapshot from memory (checked < 30 s ago)
  R-->>B: tracks, videos, albums, playlists

  Note over B,C: User copies new files into /media

  B->>R: GET /api/library (page reload, > 30 s later)
  R->>I: get()
  I->>I: fingerprint changed
  I->>S: buildLibrary(config)
  S-->>I: new LibraryResponse
  I-->>R: new library
  R-->>B: includes the new files
```

## How files become library entries

```mermaid
flowchart TD
  F[("files under /media")] --> Ext{"extension"}
  Ext -- "audio / video<br/>not in IGNORE_EXT" --> Media["TrackInfo<br/>id = base64url(path)"]
  Ext -- ".funscript" --> FS{"parseFunscriptName()"}
  FS -- "stem.type.funscript" --> Attach
  FS -- "stem.type.sub.funscript" --> Attach
  FS -- "stem.funscript" --> AttachU["type unknown (Generic)"] --> Attach
  Attach["attached to the media file<br/>with the same stem"] --> Media
  Ext -- ".md" --> Desc["description + frontmatter tags<br/>matched by stem"] --> Media
  Ext -- ".m3u" --> PL["Playlist<br/>entries resolved to track ids"]
  Media --> Album["Album<br/>grouped by artist + album tag"]
  Ext -- "anything else" --> Ignored["ignored<br/>listed in the debug log"]
```

## Forcing a rescan

Network shares sometimes don't update mtimes, so the fingerprint can miss changes. `POST /api/library/refresh` rebuilds unconditionally. There is no button for it in the UI, so call it with the session cookie, for example from the browser console:

```js
await fetch('api/library/refresh', { method: 'POST' }).then((r) => r.json());
```

Deleting `/config/cache/` also forces a full rebuild on the next request.

## What invalidates the cache

| Change | Detected by |
| --- | --- |
| File added, removed, renamed, resized, touched | media fingerprint (path, size, mtime) |
| `MEDIA_DIR`, `IGNORE_EXT`, funscript suffixes, `CHAPTER_SOURCE_PRIORITY` | config part of the fingerprint |
| Change to the cached JSON shape in code | bump `CACHE_FORMAT_VERSION` in `libraryIndex.ts` |
| Change to scan logic that doesn't change the shape | not detected. Bump `CACHE_FORMAT_VERSION` anyway |

## Code map

| Step | Files |
| --- | --- |
| Endpoint | [routes/library.ts](../../../src/server/routes/library.ts) |
| Cache, fingerprint | [services/libraryIndex.ts](../../../src/server/services/libraryIndex.ts) |
| Scan pipeline | [services/libraryService.ts](../../../src/server/services/libraryService.ts) |
| Metadata | [services/mediaProbe.ts](../../../src/server/services/mediaProbe.ts) |
| Albums, playlists | [services/albums.ts](../../../src/server/services/albums.ts), [services/playlists.ts](../../../src/server/services/playlists.ts) |
| Funscript names, chapters | [services/funscripts.ts](../../../src/server/services/funscripts.ts), [services/chapterService.ts](../../../src/server/services/chapterService.ts), [shared/chapters.ts](../../../src/shared/chapters.ts) |
| Covers | [services/artworkCache.ts](../../../src/server/services/artworkCache.ts) |
