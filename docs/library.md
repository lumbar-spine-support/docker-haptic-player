[← Back to Table of Content](index.md)

# Media Library

HAPPY works with just your audio and video files. For tagging, descriptions and haptic sync, use this structure:

```
media/
├── audio.mp3
├── audio.md                 --> tags, description
├── audio.stroker.funscript  --> funscript for stroker toy
├── audio.buttplug.funscript --> funscript for buttplug toy
├── ...
├── video.mp4
├── video-extras/            --> related files don't need to be in same directory
│   ├── video.md
│   └── video.stroker.funscript
└── playlists/
    └── favorites.m3u        --> playlists are only supported as .m3u files
```

## Filtering and sorting

Next to the search box are three controls:

- **Media type**: a dropdown to limit the library to albums, audio, playlists and/or videos. With nothing selected, everything is shown.
- **Haptics**: a dropdown to show only items that have scripts for every selected toy type.
- **Sort**: pick the field (Title, Artist, Year, Duration, Type) and click the arrow button next to it to reverse the order. Items without a value (e.g. playlists have no year) are always listed last.

Sorting applies to the grid and the list view alike, and all media types are sorted together. In the list view you can also click a column header. Filters and sort order are remembered in the browser.

## Cover art in the grid view

In the grid view, cards with widescreen cover art (typical for videos) are twice as wide as other cards. Square and portrait covers are cropped to a square. Set `CARD_VIEW_FORCE_SQUARE_ARTWORK: true` (see [configuration](configuration.md)) to show all covers as squares.

Videos without embedded cover art get a generated cover: a frame taken at `VIDEO_ARTWORK_OFFSET` percent of the video (default 10%), extracted once when the library is scanned and then cached. Set `VIDEO_ARTWORK_GENERATE: false` to turn this off. Audio files without cover art show a black player surface.

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

If your funscripts follow another naming pattern, e.g. `file-prostate.funscript` instead of `file.buttplug.funscript` you can change the separator character and expected suffixes (see [docs/configuration.md](configuration.md)).

## Markdown Descriptors

For tagging and file descriptions, create a Markdown `<audio_or_video_name>.md` file that contains tagging frontmatter and text to show.
This is the most optional part of setting up your library. Tagging becomes more useful with a growing library, and descriptions are handy for files that come with instructions to the listener/viewer.

```markdown
---
tags:
  - sfw
  - vanilla
  - funny
---

This is a description that will be rendered using Markdown-it.
You can display [links](https://github.com), **bold-text** and more.
```

## Media Metadata

The server uses [ffprobe](https://ffmpeg.org/ffprobe.html) to extract cover art, artist, date, name and chapters from the media files themselves.
The markdown files are only used to add a description with markup and tagging, both of which are not natively supported by `.mp3`, `.mp4` or similar files.
Use [Mp3tag](https://www.mp3tag.de/) (Win) or [Puddletag](https://docs.puddletag.net/) (Linux) to add metadata to your files.

Metadata HAPPY parses using `ffprobe`:
- Album Cover
- Album Artist
- Track Artist
- Release Year
- Chapters

## Chapters

Chapters split the progress bar into segments. Pressing or dragging the bar near a chapter start snaps to it (hold <kbd>Shift</kbd> to seek freely), and the chapter name is shown in the preview while dragging.

HAPPY reads chapters from two sources. `CHAPTER_SOURCE_PRIORITY` (`chapterSourcePriority` in `settings.yaml`) sets their order; the first source that provides chapters wins. Leave it empty to disable chapters.

- `funscript`: `metadata.chapters` of the funscripts belonging to the media file, in the format used by [OpenFunscripter](https://github.com/OpenFunscripter/OFS) and [MultiFunPlayer](https://github.com/Yoooi0/MultiFunPlayer). If several funscripts of a file define chapters, they are merged and a warning is logged.
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
- `embedded`: chapters stored in the media file itself (e.g. MP4, MKV, MP3). To add them, write an [FFMETADATA](https://ffmpeg.org/ffmpeg-formats.html#Metadata-1) file and mux it in without re-encoding:
  ```shell
  ffmpeg -i input.mp4 -i chapters.txt -map 0 -map_metadata 0 -map_chapters 1 -codec copy output.mp4
  ```

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

