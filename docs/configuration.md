[← Back to Table of Content](index.md)

# Configuration

After the first container start, a `settings.yaml` is created in the directory mounted at `/config`. Changing these settings only gets picked up after a server restart, so keep that in mind. If new settings become available or deprecated with updates, the server will automatically append or comment out those settings.

Every YAML setting can also be set as an environment variable. Environment variables take precedence over YAML settings, so a `/config` mount is optional if you set everything in your `docker-compose.yml`.

<!-- ENV_OPTIONS -->

| Setting | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port of the web interface. |
| `MEDIA_DIR` | `/media` | Directory that contains media files (inside container). |
| `IGNORE_EXT` | *(empty)* | File extensions to ignore (without leading dot) |
| `PASSWORD` | `happy` | Web interface access password. Leave empty to disable authentication |
| `TRUST_PROXY` | `0` | Number of reverse proxy hops to trust for X-Forwarded-* headers. 0 for direct LAN access, 1 behind nginx/Traefik |
| `LOG_LEVEL` | `info` | Verbosity of the console log: error, warn, info, debug |
| `FUNSCRIPT_SUFFIX_SEPARATOR` | `.` | Single character that separates filename from funscript suffix |
| `FUNSCRIPT_SUFFIX_STROKER` | `stroker` | Suffix associated with stroker funscript |
| `FUNSCRIPT_SUFFIX_BUTTPLUG` | `buttplug` | Suffix associated with buttplug funscript |
| `FUNSCRIPT_SUFFIX_VIBRATOR` | `vibrator` | Suffix associated with vibrator funscript |
| `FUNSCRIPT_SUFFIX_ESTIM` | `estim` | Suffix associated with estim funscript |
| `FUNSCRIPT_SUFFIX_MACHINE` | `machine` | Suffix associated with machine funscript |
| `CHAPTER_SOURCE_PRIORITY` | `embedded,funscript` | Chapter sources in order of precedence: embedded, funscript. The first source that provides chapters is used. Empty to disable chapters |
| `VIDEO_ARTWORK_GENERATE` | `true` | Generate artwork from a video frame for videos without embedded cover art. Frames are extracted on startup and cached. |
| `VIDEO_ARTWORK_OFFSET` | `10` | Position of the generated video artwork frame, in percent (0-100) of the video duration. |
| `STORYBOARD_GENERATE` | `true` | Generate storyboards (thumbnail sprite sheets) for timeline previews of videos. Generated in the background and cached. |
| `STORYBOARD_INTERVAL` | `10` | Seconds between two storyboard thumbnails (whole number, minimum 1). Changing it regenerates all storyboards. |
| `STORYBOARD_WIDTH` | `240` | Width of one storyboard thumbnail in pixels (80-640). Changing it regenerates all storyboards. |
| `VIDEO_SEEK_INTERVAL` | `10` | Seek interval in seconds when double-tapping/clicking. |
| `DEFAULT_BLUR_CONTENT` | `false` | Enable to blur images and videos. Can be toggled in web interface. |
| `DEFAULT_HAPTIC_FREQUENCY` | `30` | Intiface Haptic update frequency in Hz. Smaller values are usually more stable but less precise. Can be changed in web interface. |
| `DEFAULT_HAPTIC_DELAY` | `0` | Default haptic delay in milliseconds to sync video and haptics. Can be changed in web interface. |
| `HAPTIC_DELAY_LIMIT` | `500` | Maximum absolute haptic delay in milliseconds selectable in the web interface (range is -limit to +limit). |
| `DGLAB_ENABLED` | `false` | (EXPERIMENTAL) Enable DG-Lab Coyote 3.0 component for e-stim toy control. |
| `DGLAB_SANDBOX_ENABLED` | `true` | Show the DG-Lab sandbox page for testing waveform patterns without media. Only has an effect when DG-Lab is enabled. |
| `AUTO_RECONNECT_INTIFACE` | `true` | Reconnect to Intiface on page load if it was connected when the page was last used. |
| `AUTO_RECONNECT_DGLAB` | `true` | Reconnect to the DG-Lab relay on page load if it was connected and last seen less than 5 minutes ago. |
| `FUNSCRIPT_INTERPOLATION_METHOD` | `pchip` | How positions between funscript points are computed for haptics and the timeline: none, linear, pchip. none holds each position until the next point; strokers follow pchip as linear |
| `FUNSCRIPT_COLOR_GRADIENT` | `false` | Colour the timeline graph on a heat scale by movement speed (blue = slow, red = fast). Can be toggled in web interface. |
| `CARD_VIEW_FORCE_SQUARE_ARTWORK` | `false` | If true, the media's artwork is reduced to a square. This ensures a consistent layout. |
| `CARD_VIEW_LARGE_PORTRAIT_ARTWORK` | `false` | If true, portrait artwork takes up two rows. |

<!-- /ENV_OPTIONS -->