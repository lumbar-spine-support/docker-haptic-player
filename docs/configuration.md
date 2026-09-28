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
| `AUTOSCRIPT_ENABLED` | `true` | Offer an "Auto" funscript generated from the audio track of each media file (requires ffmpeg) |
| `AUTOSCRIPT_MIN_FREQUENCY` | `20` | Lower bound in Hz of the frequency band analysed for the Auto funscript |
| `AUTOSCRIPT_MAX_FREQUENCY` | `200` | Upper bound in Hz of the frequency band analysed for the Auto funscript |
| `AUTOSCRIPT_MIN_POWER` | `0.05` | Relative power (0-1, normalised to the loudest moment of each frequency in the file) below which the Auto funscript is at position 0 |
| `AUTOSCRIPT_TYPE` | `generic` | Device type the Auto funscript is played on: generic, stroker, buttplug, vibrator, estim, machine |
| `AUTOSCRIPT_FRAME_MS` | `50` | Time resolution of the Auto funscript in milliseconds |
| `AUTOSCRIPT_MIN_POSITION_DELTA` | `2` | Minimum position change (0-100) required to emit a new Auto funscript point |
| `VIDEO_SEEK_INTERVAL` | `10` | Seek interval in seconds when double-tapping/clicking. |
| `DEFAULT_BLUR_CONTENT` | `false` | Enable to blur images and videos. Can be toggled in web interface. |
| `DEFAULT_HAPTIC_FREQUENCY` | `30` | Intiface Haptic update frequency in Hz. Smaller values are usually more stable but less precise. Can be changed in web interface. |
| `DEFAULT_HAPTIC_DELAY` | `0` | Default haptic delay in milliseconds to sync video and haptics. Can be changed in web interface. |
| `DGLAB_ENABLED` | `false` | (EXPERIMENTAL) Enable DG-Lab Coyote 3.0 component for e-stim toy control. |
| `FUNSCRIPT_INTERPOLATION_METHOD` | `linear` | How positions between funscript points are computed for haptics and the timeline: none, linear, pchip. none holds each position until the next point; strokers follow pchip as linear |
| `FUNSCRIPT_COLOR_GRADIENT` | `false` | Colour the timeline graph on a heat scale by movement speed (blue = slow, red = fast). Can be toggled in web interface. |

<!-- /ENV_OPTIONS -->