[← Developer Guide](../README.md)

# Use case: Mark a favorite

**Goal:** the user marks a video as a favorite in HAPPY, Jellyfin stores it, and the favorites filter shows it.

Favorites belong to the signed-in Jellyfin user. HAPPY keeps no copy of its own: it reads the flag with the library and writes changes straight back, so Jellyfin's own apps show the same hearts.

## 1. Favorites arrive with the library

```mermaid
sequenceDiagram
  autonumber
  participant L as Library
  participant API as api.ts
  participant J as Jellyfin

  L->>API: fetchLibrary()
  API->>J: GET /Items?…&EnableUserData=true
  J-->>API: BaseItemDto[] with UserData.IsFavorite
  API->>J: GET /Items?IncludeItemTypes=Playlist&EnableUserData=true
  J-->>API: playlists with UserData.IsFavorite
  API-->>L: TrackInfo.isFavorite, PlaylistInfo.isFavorite
  L->>L: render(): cards and rows get a heart (createFavoriteButton)
```

## 2. Toggle the heart

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant B as heart button
  participant F as favorites.ts
  participant API as api.ts
  participant J as Jellyfin

  U->>B: click (stopPropagation: the card does not open)
  B->>F: toggleFavorite(item)
  F->>F: ignore if a request for item.id is in flight
  F->>F: item.isFavorite = !previous, redraw every [data-favorite-id]
  F->>API: setJellyfinFavorite(id, favorite)
  API->>J: POST or DELETE /UserFavoriteItems/{id}?userId=…
  alt 2xx
    J-->>F: UserItemDataDto { IsFavorite }
    F->>F: item.isFavorite = stored state
  else error
    J-->>F: HTTP error
    F->>F: revert to previous, log to the console
  end
  F->>F: redraw every [data-favorite-id] for the item
```

The flag lives on the in-memory `TrackInfo`/`PlaylistInfo`, which the library, the player and the playlist page share. The player's heart is `<media-favorite-button>` in the Video.js control bar: it reads its slot's `data-track-id` and asks the `FavoriteTarget` the app published (`setFavoriteTarget()`); `renderAll()` calls `notifyFavoriteChanged()` so both slots redraw. The library is not re-rendered, so the grid does not jump; the favorites filter picks up the change on the next `render()`.

## 3. Filter

The heart next to the haptics dropdown sets `Library.favoritesOnly` (saved in `happy-library-filters`). `render()` then keeps favorite tracks, videos and playlists, and albums with at least one favorite track (`albumHasFavorite()`).

## Code map

| Step | Files |
| --- | --- |
| Loading and writing back | [jellyfin/library.ts](../../../src/client/jellyfin/library.ts), [jellyfin/mapper.ts](../../../src/client/jellyfin/mapper.ts), [api.ts](../../../src/client/api.ts) |
| Heart buttons | [components/library/favorites.ts](../../../src/client/components/library/favorites.ts), [videojs/ui/favorite-button.ts](../../../@/components/videojs/ui/favorite-button.ts), [videojs/features/favorite.ts](../../../@/components/videojs/features/favorite.ts), [components/library/index.ts](../../../src/client/components/library/index.ts), [components/library/detail.ts](../../../src/client/components/library/detail.ts), [index.ts](../../../src/client/index.ts) |
| Filter | [components/library/index.ts](../../../src/client/components/library/index.ts), [shared/libraryFiltering.ts](../../../src/shared/libraryFiltering.ts) |
