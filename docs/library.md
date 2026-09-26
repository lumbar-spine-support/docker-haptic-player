[← Back to Documentation](index.md)

# Library Setup

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
**Generic**. They can be assigned to any device just like typed scripts.

Suffixes and the separator can be changed, see [Configuration](configuration.md#funscript-naming).

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
```

## Media Metadata

The server uses [music-metadata](https://www.npmjs.com/package/music-metadata) to extract cover art, artist, date and name from the media files themselves.
The markdown files are only used to add a description with markup and tagging, both of which are not natively supported by `.mp3`, `.mp4` or similar files.
Use [Mp3tag](https://www.mp3tag.de/) (Win) or [Puddletag](https://docs.puddletag.net/) (Linux) to add metadata to your files.
