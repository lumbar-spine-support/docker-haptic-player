[← Back to Table of Content](index.md)

# Configuration

After the first container start, a `settings.yaml` is created in the directory mounted at `/config`.

Every YAML setting can also be set as an environment variable. Environment variables take precedence over YAML settings, so a `/config` mount is optional if you set everything in your `docker-compose.yml`.

Authentication settings (`PASSWORD`, `TRUST_PROXY`, `CONFIG_PATH`) are described in [Installation](installation.md#authentication). The DG-Lab switch is described in [DG-Lab Coyote 3.0](dg-lab.md).

<!-- ENV_OPTIONS -->

| Setting | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port of the web interface |
| `MEDIA_DIR` | `/media` | Directory that contains media files |
| `IGNORE_EXT` | *(empty)* | File extensions to ignore (without leading dot) |
| `PASSWORD` | `happy` | Web interface access password. Leave empty to disable authentication |
| `TRUST_PROXY` | `0` | Number of reverse proxy hops to trust for X-Forwarded-* headers. 0 for direct LAN access, 1 behind nginx/Traefik |
| `LOG_LEVEL` | `info` | Verbosity of the console log: error, warn, info, debug |
| `FUNSCRIPT_SUFFIX_SEPARATOR` | `.` | Character that separates filename from funscript suffix |
| `FUNSCRIPT_SUFFIX_STROKER` | `stroker` | Suffix for stroker funscript files |
| `FUNSCRIPT_SUFFIX_BUTTPLUG` | `buttplug` | Suffix for buttplug funscript files |
| `FUNSCRIPT_SUFFIX_VIBRATOR` | `vibrator` | Suffix for vibrator funscript files |
| `FUNSCRIPT_SUFFIX_ESTIM` | `estim` | Suffix for estim funscript files |
| `FUNSCRIPT_SUFFIX_MACHINE` | `machine` | Suffix for machine funscript files |
| `VIDEO_SEEK_INTERVAL` | `10` | Default skip interval in seconds for the seek buttons (TODO: unused) |
| `DEFAULT_BLUR_CONTENT` | `false` | Default setting for blurring of images and videos. Can be changed in client. |
| `DEFAULT_HAPTIC_FREQUENCY` | `30` | Default haptic update frequency in Hz. Can be changed in client. |
| `DEFAULT_HAPTIC_MASTER_STRENGTH` | `100` | Default haptic master strength in percent. Can be changed in client. |
| `DEFAULT_HAPTIC_DELAY` | `0` | Default haptic delay in milliseconds to sync video and haptics. Can be changed in client. |
| `DGLAB_ENABLED` | `false` | (EXPERIMENTAL) Enable DG-Lab Coyote 3.0 component for e-stim toy control |

<!-- /ENV_OPTIONS -->
