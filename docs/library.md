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

Chapters are drawn as lines on the progress bar. Pressing or dragging the bar near a line snaps to it (hold <kbd>Shift</kbd> to seek freely), and the chapter name is shown in the preview while dragging.

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

