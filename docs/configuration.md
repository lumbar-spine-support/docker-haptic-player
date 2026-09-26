# Configuration

After the first container start, a `settings.yaml` is created in the directory mounted at `/config`.

Every YAML setting can also be set as an environment variable. Environment variables take precedence over YAML settings, so a `/config` mount is optional if you set everything in your `docker-compose.yml`.

Authentication settings (`PASSWORD`, `TRUST_PROXY`, `CONFIG_PATH`) are described in [Installation](installation.md#authentication). The DG-Lab switch is described in [DG-Lab Coyote 3.0](dg-lab.md).

## Funscript naming

If your funscripts follow another naming pattern, e.g. `file-prostate.funscript` instead of `file.buttplug.funscript`, change:

```yaml
# Character that separates filename from funscript suffix
FUNSCRIPT_SUFFIX_SEPARATOR: "-"

# Suffix for buttplug funscript files
FUNSCRIPT_SUFFIX_BUTTPLUG: "prostate"
```

## Logging

Everything the server logs goes to the docker console, so `docker compose logs -f app` shows the live log.

| Setting | Default | Description |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | One of `error`, `warn`, `info`, `debug`. Each level includes the ones above it. |

Set it like any other setting, e.g. `LOG_LEVEL: "debug"` in `settings.yaml` or `LOG_LEVEL=debug` in the environment.

At `info` you get the startup summary of the scanned media directory, every login, logout and rejected login attempt, and a line whenever a client connects for the first time:

```
2026-09-23T22:05:13.150Z INFO  [library] Scanned /media: 42 media files (37 audio, 5 video), 12 with funscripts, 3 playlists, 4 ignored files
2026-09-23T22:05:31.004Z INFO  [request] Client connected: 192.168.1.24 (Mozilla/5.0 ...)
2026-09-23T22:05:33.887Z INFO  [auth-route] Successful login from 192.168.1.24 (Mozilla/5.0 ...)
```

At `debug` the startup summary is followed by one line per media file — with its category and the funscripts found for it — and one line per ignored file including the reason it was skipped. Every HTTP request is logged as well:

```
2026-09-23T22:05:13.151Z DEBUG [library]   audio album/track01.mp3 (funscripts: stroker, estim/nipples)
2026-09-23T22:05:13.151Z DEBUG [library]   video clips/demo.mp4 (no funscript)
2026-09-23T22:05:13.152Z DEBUG [library]   ignored notes.txt (unsupported extension (.txt))
2026-09-23T22:05:13.152Z DEBUG [library]   ignored raw/take.wav (IGNORE_EXT (.wav))
2026-09-23T22:05:31.010Z DEBUG [request] 192.168.1.24 GET /api/library -> 200 (7ms)
```
