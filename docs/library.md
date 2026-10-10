[← Back to Table of Content](index.md)

# Media Library

HAPPY plays the media of your [Jellyfin](https://jellyfin.org/) libraries. Jellyfin reads names, artists, years, cover art and chapters from your files; HAPPY adds funscripts that sit next to them:

```
audio/                       --> a Jellyfin library
├── audio.mp3
├── audio.stroker.funscript  --> funscript for stroker toy
├── audio.buttplug.funscript --> funscript for buttplug toy
└── ...
video/                       --> another Jellyfin library
├── video.mp4
└── scripts/                 --> scripts may sit in a subfolder of the same library
    └── video.stroker.funscript
```

## Jellyfin libraries

Add your folders as libraries in Jellyfin (*Dashboard → Libraries*). HAPPY shows every audio and video item the signed-in user can see, or only those of the libraries chosen on the plugin's settings page (see [Configuration](configuration.md#libraries)).

- **Audio**: use the **Books** library type. Jellyfin only turns the comment tag of an audio file into its description for audiobooks; in a Music library the description would be missing. Jellyfin does not build albums for audiobooks, so HAPPY groups tracks into albums itself, by album artist and album tag.
- **Video**: use **Mixed movies and shows** or **Home videos and photos**. No online metadata is needed; turn the metadata downloaders off if Jellyfin should not rename your files.
- Media plays as the original file, never transcoded. Your browser must be able to decode it (see [Video codecs](#video-codecs)).

Playlists are Jellyfin playlists. Create them in Jellyfin, or save a [queue](#queue) from HAPPY; `.m3u` files in your media folders are not read by HAPPY.

## Tags and descriptions

- **Tags** are Jellyfin's tags plus genres. Jellyfin never reads its *Tags* field from tags embedded in a media file, so the file-based route is the genre:
  - **Audio:** give the genre field several values (most taggers can store multiple values in one field; Mp3tag separates them with `\\`). A single text like `sfw; vanilla` stays one genre, unless you enable custom tag delimiters in the library settings.
  - **Video:** an embedded genre like `sfw; vanilla; funny` is split into separate genres. For Jellyfin's *Tags*, put an NFO file next to the video (`<video name>.nfo` with `<tag>` entries, see below).
  - Tags can also be set by hand in Jellyfin's metadata editor.
- **Descriptions** are Jellyfin's overview of the item. For audio, put the text into the file's comment tag. Markdown is rendered, so you can use [links](https://github.com), **bold text** and more.

Markdown sidecar files (`<name>.md`) are no longer read; move their tags into the genre field (or an NFO for videos) and their text into the comment (audio) or the NFO's `<plot>` (video).

A video NFO looks like this; Jellyfin reads it when NFO is enabled as a metadata reader of the library (the default):

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie>
  <title>My video</title>
  <plot><![CDATA[**Markdown** description]]></plot>
  <genre>Comedy</genre>
  <tag>sfw</tag>
  <tag>funny</tag>
</movie>
```

Use [Mp3tag](https://www.mp3tag.de/) (Win) or [Puddletag](https://docs.puddletag.net/) (Linux) to edit these tags, then rescan the library in Jellyfin.

## Filtering and sorting

Next to the search box are four controls:

- **Media type**: a dropdown to limit the library to albums, audio, playlists and/or videos. With nothing selected, everything is shown.
- **Haptics**: a dropdown to show only items that have scripts for every selected toy type.
- **Favorites** (heart): show only your favorites (see [Favorites](#favorites)).
- **Sort**: pick the field (Title, Artist, Year, Duration, Type) and click the arrow button next to it to reverse the order. Items without a value (e.g. playlists have no year) are always listed last.

Sorting applies to the grid and the list view alike, and all media types are sorted together. In the list view you can also click a column header. Filters and sort order are remembered in the browser.

## Favorites

HAPPY uses the favorites of your Jellyfin account, the same ones Jellyfin's own apps show with a heart. Click the heart on a card, in the list view, in the player's top bar (next to picture-in-picture and fullscreen) or on a playlist's page to add or remove a favorite; HAPPY saves it in Jellyfin right away.

- Audio files, videos and playlists can be favorites. Albums are grouped by HAPPY, not by Jellyfin, so they have no heart of their own; with the favorites filter on, an album is shown when one of its tracks is a favorite.
- Favorites you change in another Jellyfin app show up in HAPPY after a page reload.
- With the favorites filter on, an item you remove from your favorites stays visible until the library is redrawn (for example when you change a filter), so it does not vanish under your mouse.

## Queue

What plays next is the queue. Playing an album or a playlist (its **Play** or **Shuffle** button, or one of its tracks) fills the queue with it; after that the queue is yours to change. Playing a single file on its own does not throw the queue away: the file plays now and the rest of the queue follows.

- **Add to the queue**: the **⋯** menu on a card, a list row or a row of an album/playlist page has **Play next** and **Add to queue**. Album and playlist pages also have a **+** button that queues all of it.
- **See and change the queue**: the queue button in the player's control bar (next to the settings button) opens the list with what plays now at the top and what is up next below it; scroll up to see the last ten played. Drag an entry by its handle to any place (or use Alt+↑/↓ on the handle), remove it with ×, or click it to play it. The buttons at the top switch repeat (off → repeat the queue → repeat the current file), and shuffle or clear what is up next. Entries slide to their new place, so you can follow what moved.
- **Save the queue**: *Save as…* stores the whole queue, in order, as a new Jellyfin playlist that only you can see. A queue that came from one of your playlists can be written back with *Save* once you changed it. HAPPY refuses to overwrite a playlist that holds media from libraries HAPPY does not show, or that was changed elsewhere in the meantime, so nothing gets lost; save it as a new playlist instead. Saved playlists appear in the library right away and in Jellyfin's other apps too.
- **Delete a playlist**: the **⋯** menu of one of your own playlists in the library has *Delete playlist*. After you confirm, the playlist is removed from Jellyfin, for all apps; the media in it stays.

The queue lives in the open browser tab and is gone after a reload; save it as a playlist to keep it. The bar at the bottom of the page shows what is playing while you browse; click it to get back to the player and its queue.

## Cover art in the grid view

In the grid view, cards with widescreen cover art (typical for videos) are twice as wide as other cards. Square and portrait covers are cropped to a square. Turn on *Crop artwork to squares* on the plugin's settings page (see [configuration](configuration.md#library)) to show all covers as squares.

Cover art is Jellyfin's primary image of each item: embedded cover art, an image next to the file, or a frame Jellyfin extracted from the video. Audio files without cover art show a black player surface.

## Video codecs

Videos are streamed as-is and decoded by your browser. If the browser cannot decode the video track (for example HEVC/H.265 on many Linux desktops), HAPPY shows a warning under the player and a browser notification, and only the audio plays.

## Funscripts

Funscripts must at least contain an `actions` field with an array of `at/pos` structures.

```json
// <audio_or_video_name>.<toy-suffix>.funscript
{
  "actions": [
    {"at": 0,   "pos": 0},
    {"at": 100, "pos": 100},
    ...
  ]
}
```

To have two scripts of the same type, add a second, arbitrary suffix:

```
file.mp4
file.vibrator.cock.funscript
file.vibrator.balls.funscript
```

Funscripts without a recognised toy suffix (`file.funscript`) are still picked up and listed as
*Generic*. They can be assigned to any device just like typed scripts.

If your funscripts follow another naming pattern, e.g. `file-prostate.funscript` instead of `file.buttplug.funscript` you can change the separator character and expected suffixes on the plugin's settings page (see [Configuration](configuration.md#funscript-file-names)). The plugin matches files with the new separator within about 30 seconds; reload HAPPY afterwards.

### Where funscripts are found

Jellyfin does not know funscripts; the HAPPY plugin finds them. It looks through all folders of your Jellyfin libraries and assigns each `.funscript` file to the media file whose name it starts with:

- The longest match wins: `scene.part2.stroker.funscript` belongs to `scene.part2.mp4` if that exists, otherwise to `scene.mp4`.
- A media file in the same folder as the script wins. Otherwise the script is attached to every media file with that name anywhere in the same library folder, so scripts may live in a separate subfolder.
- New scripts show up after the next library scan in Jellyfin, or within about 30 seconds.



## Chapters

Chapters split the progress bar into segments. Pressing or dragging the bar near a chapter start snaps to it (hold <kbd>Shift</kbd> to seek freely), and the chapter name is shown in the preview while dragging.

HAPPY takes chapters from two sources. *Chapters* on the plugin's settings page sets their order; the first source that provides chapters wins. *No chapters* turns them off (see [Configuration](configuration.md#playback)).

- `funscript`: `metadata.chapters` of the funscripts belonging to the media file, in the format used by [OpenFunscripter](https://github.com/OpenFunscripter/OFS) and [MultiFunPlayer](https://github.com/Yoooi0/MultiFunPlayer). If several funscripts of a file define chapters, they are merged and a warning is logged in the browser console.
  ```json
  {
    "metadata": {
      "chapters": [
        { "name": "Introduction", "startTime": "00:00:00.000", "endTime": "00:03:00.000" },
        { "name": "Finale", "startTime": "00:03:00.000" }
      ]
    },
    "actions": []
  }
  ```
- `embedded`: chapters stored in the media file itself (e.g. MP4, MKV, MP3), as read by Jellyfin. To add them, write an [FFMETADATA](https://ffmpeg.org/ffmpeg-formats.html#Metadata-1) file and mux it in without re-encoding:
  ```shell
  ffmpeg -i input.mp4 -i chapters.txt -map 0 -map_metadata 0 -map_chapters 1 -codec copy output.mp4
  ```
  Rescan the file in Jellyfin afterwards so it picks up the new chapters.

## Timeline thumbnails

Hovering or dragging the progress bar of a video shows a preview frame together with the time and chapter name. The frames are Jellyfin's **trickplay** images. Enable them per library (*Library settings → Enable trickplay image extraction*) and let the scheduled task *Generate Trickplay Images* run; HAPPY uses them as soon as they exist. For VR180 videos the preview shows one eye. Audio files show only time and chapter.

## VR180 videos

Videos whose filename marks them as VR180 open as a panorama you can look around in, like 360° videos on YouTube. Tokens are matched case-insensitively between `_`, `.`, `-` or spaces:

| Filename contains | Layout |
| --- | --- |
| `180` and `LR`, `SBS` or `3DH` (e.g. `Scene_180_LR.mp4`) | side by side |
| `180` and `TB`, `OU` or `3DV` (e.g. `Scene_180_TB.mp4`) | top/bottom |
| `VR180` alone | side by side |

Navigation:

- **Desktop**: drag with the mouse to look around, scroll to zoom. A click without dragging plays/pauses, a double-click toggles fullscreen.
- **Phone/tablet**: drag with one finger, pinch to zoom; a tap toggles the controls.
- **Motion control** (phone icon, phones/tablets only): look around by moving the device. It needs HTTPS; iOS asks for permission on first use.

The VR button in the control bar switches between the panorama and the raw side-by-side/top-bottom frame. The view resets for each new track. Very high resolutions (8K) may play poorly on phones.

