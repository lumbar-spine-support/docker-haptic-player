# HAPPY ⸺ Docker Haptic Player

**HAPPY** is a self-hosted **hap**tic **p**la**y**er for audio and video files.

![Preview](./docs/screenshots/library-landscape.jpg)

Key features:

- Minimally intrusive: no internet required, only read-access to your media volume.
- No SQL database; everything is stored in the media files themselves and optionally markdown files.
- [Intiface Central](https://intiface.com/) as robust hardware bridge to your haptic toys.
- Widespread `.funscript` format is used for haptic control
- Multiple haptic toys in parallel are supported!
- Modern [Video.JS v10](https://videojs.org/blog/videojs-v10-release-candidate) framework for audio and video playback.
- Modern [Bootstrap](https://getbootstrap.com/) OLED-friendly, mobile-first UI.
- Prebuilt Docker image for easy setup.

What it tries not to be:

- A funscript editor. There are plenty of good tools already.
- A media file metadata editor. Use [Mp3tag](https://www.mp3tag.de/) (Win) or [Puddletag](https://docs.puddletag.net/) (Linux) instead.

## Overview

```mermaid
flowchart LR
  Media[(Media Volume)]
  Client[HAPPY\nClient]
  HAPPY[HAPPY\nServer]
  Intiface[Intiface\nCentral]
  Toys[Haptic\nPeripherals]

  Client -->|GET-API| HAPPY
  HAPPY -->|Serves| Client
  Client <-->|Buttplug.io-API| Intiface
  Intiface -->|Bluetooth / USB| Toys
  Media -->|Docker Mount| HAPPY
```

## Installation

### Intiface Central

For haptic support you will need to install [Intiface Central](https://intiface.com/#intiface-central).
Intiface Central connects to your toys directly and provides a generic API for haptic control. That makes it easy for this application to work with arbitrary haptic toys.

If you haven't used Intiface Central yet, check out their [Quickstart Guide](https://intiface.com/docs/intiface-central/quickstart). In short: start the server with the big "play" button, then press "start scan". If your devices are in pairing mode and are supported, it should be able to find the devices. Each device will expose different features like a "linear", "vibrate" or "rotate" feature. Each feature can be assigned to the same or different funscripts.

### DG-Lab Coyote 3.0 (experimental)

The Coyote is not supported by Intiface, so HAPPY can talk to it directly through the official
DG-Lab 4 app. The app keeps full ownership of your safety limits; HAPPY only ever requests a
strength at or below the ceiling the app reports.

The feature is **off by default**. Turn it on with `DGLAB_ENABLED: true` in `settings.yaml` or
`DGLAB_ENABLED=true` in the environment, then restart. While disabled, the WebSocket endpoint
does not exist and the settings section is not rendered at all.

Pairing:

1. Open HAPPY and the settings sidebar, then press **Enable** in the DG-Lab section.
2. Check the address shown. It defaults to the host you loaded HAPPY from, which is wrong when
   HAPPY runs on a desktop browser at `localhost` — the phone cannot reach that. Replace it with
   the machine's LAN IP (e.g. `192.168.1.10:3000`); the value is remembered.
3. On the phone running the DG-Lab 4 app, tap **Open in DG-Lab app**. If HAPPY is open on a
   desktop browser instead, copy the shown `ws://…` address and enter it in the app by hand.
4. Once the app attaches, the Coyote's two channels appear in Device Assignment and can be
   assigned to any funscript, exactly like an Intiface actuator.

> **Safety:** set your comfort limits in the DG-Lab app before assigning a script. Output stops
> within ~300 ms whenever playback pauses, the tab closes, or the connection drops.

Both channels must be **unmuted in the DG-Lab app**; a muted channel accepts commands and
stays silent. The channel labels in Device Assignment show the current mute state and limit.

To trace the wire protocol when something misbehaves, set `localStorage['happy-dglab-debug'] =
'true'` in the browser console and reload. Warnings and rejected commands are always logged.

### Library Setup

HAPPY works with just your audio and video files. But if you want a more polished experience with tagging, file description and synchronization of haptic toys with your files, consider the following structure.

```
media/
├── audio.mp3
├── audio.md                 --> tags, description
├── audio.stroker.funscript  --> funscript for stroker toy
├── audio.buttplug.funscript --> funscript for buttplug toy
├── ...
├── video.mp4
├── video-extras/             --> related files don't need to be in same directory
│   └── video.md
│   └── video.stroker.funcscript
└── playlists/
    └── favorites.m3u        --> playlists are only supported as .m3u files
```

#### Funscripts

Funscripts must at least contain an `actions` field with an array of `at/pos` structures.

```json
// <audio_or_video_name>.<toy-suffix>.funscript
{
  "metadata": {
    "title": "",
    "creator": "",
    "tags": [],
    "chapters": [] // Currently not used; may be used in the future to show chapters in video player.
  },
  "actions": [
    {"at": 0,   "pos": 0},
    {"at": 100, "pos": 100},
    ...
  ]
}
```

In case want two scripts of the same type, name them as follows. The second suffix is arbitrary.

```
file.mp4
file.vibrator.cock.funscript
file.vibrator.balls.funscript
```

Funscripts without a recognised toy suffix (`file.funscript`) are still picked up and listed as
**Generic**. They can be assigned to any device just like typed scripts.

#### Markdown Descriptors

For tagging and file descriptions to work, create a Markdown `<audio_or_video_name>.md` file that contains tagging frontmatter and text to show.
Consider this is the most optional part of setting up your library. Tagging becomes more useful with growing library. And file descriptions may become interesting for files that come with instructions to the listener/viewer.

```markdown
---
tags:
  - sfw
  - vanilla
  - funny
---

This is a description that will be rendered using Markdown-it.
```

#### Media Metadata

The server uses [music-metadata](https://www.npmjs.com/package/music-metadata) to extract cover art, artist, date and name from the media files themselves.
The markdown files are only used to add a description with markup and tagging, both of which are not natively supported by `.mp3`, `.mp4` or similar files.
I recommend to use [Mp3tag](https://www.mp3tag.de/) (Win) or [Puddletag](https://docs.puddletag.net/) (Linux) to add that metadata to your files.

### Docker Setup

Create a `docker-compose.yml`. If you have one media directory with multiple subfolders, you can mount it to `/media` as follows.

```yaml
services:
  app:
    image: ghcr.io/lumbar-spine-support/docker-haptic-player:latest
    ports:
      - "8069:3000"
    volumes:
      - ./media:/media:ro # Audio, Video, Playlists, Funscripts (read-access)
      - ./config:/config # Persistent application settings (read/write access)
    restart: unless-stopped
```

In case you want to mount multiple folders, mount them as subfolders in `/media`. HAPPY does not care how the media is sorted. It connects media files with metadata and funscript files using their name only.

```yaml
volumes:
  - ./media/audio:/audio:ro # Audio, Funscripts (read-only)
  - ./media/video:/video:ro # Video, Funscripts (read-only)
  - ./media/playlists:/playlists:ro # Playlists (read-only)
  - ./config:/config # Persistent application settings (write-access required)
```

Now start the app using `docker compose up -d`. After a few seconds the app should be reachable under `http://<HOST>:8069`.

After the initial docker container startup, you should be able to find a `settings.yaml` in the directory you mounted at `/config` inside the container. Inside the generated file you will have some settings you may want to tweak in case you need to stick to another naming pattern for funscripts and or suffixes. For example you may want to have `file-prostate.funscript` not `file.buttplug.funscript`. To achieve that you could change the settings to:

```yaml

...
# Character that separates filename from funscript suffix
FUNSCRIPT_SUFFIX_SEPARATOR: "-"

# Suffix for buttplug funscript files
FUNSCRIPT_SUFFIX_BUTTPLUG: "prostate"
...
```

Note that you can also set all YAML-variables as environment variables instead. Environment variables have prescedence over YAML settings. This means you don't need a `/config/` mount, you can also set everything through environment variables in your `docker-compose.yml`.

### Logging

Everything the server logs goes to the docker console, so `docker compose logs -f app` shows the live log. How much is written is controlled by a single setting:

| Setting | Default | Description |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | One of `error`, `warn`, `info`, `debug`. Each level includes the ones above it. |

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

Set it like any other setting, e.g. `LOG_LEVEL: "debug"` in `settings.yaml` or `LOG_LEVEL=debug` in the environment.

## Authentication

HAPPY is protected by a single shared password. Nothing — not the page, not the JavaScript bundle, not the API — is served before you sign in. There are no user accounts.

| Setting | Default | Description |
| --- | --- | --- |
| `PASSWORD` | `happy` | The password for the login screen. **Change this.** Set it to an empty string to disable authentication entirely. |
| `CONFIG_PATH` | `/config` | Directory holding `settings.yaml` and `tokens.txt`. Must be writable to stay signed in across restarts. |
| `TRUST_PROXY` | `0` | Number of reverse proxy hops to trust. Use `1` when running behind nginx/Traefik. |

Signing in stores an access token in an `HttpOnly` cookie and appends it to `tokens.txt` in the config directory. Because that directory is the `/config` mount, you stay signed in across container restarts and image upgrades.

If the config directory is not writable, the server logs a `[tokens]` warning at startup and keeps sessions in memory only — login works, but every restart requires signing in again.

**To sign every device out, delete the token file:**

```bash
rm ./config/tokens.txt
```

This takes effect immediately, no restart needed. You can also open the settings panel and use *Sign out* to revoke only the current device.

### Running behind a reverse proxy

On a LAN over plain HTTP the defaults are correct and nothing needs changing. Behind a TLS-terminating proxy, set `TRUST_PROXY=1` and forward the protocol so the session cookie can be marked `Secure`:

```nginx
location / {
    proxy_pass http://happy:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Leave `TRUST_PROXY` at `0` when the container is reachable directly, otherwise clients could spoof `X-Forwarded-For` and bypass the login rate limit.

## Planned Features

- [ ] Video.JS player improvements
  - [ ] Funscript chapters shown in Video.JS player for navigation.
  - [ ] VR Video support once Video.JS v10 matures.
- [ ] Playlist editor and a seperate mount with write-access.

## Screenshots

| Library View                                          | Player View                                         |
| ----------------------------------------------------- | --------------------------------------------------- |
| ![Library Screenshot](./docs/screenshots/library.jpg) | ![Player Screenshot](./docs/screenshots/player.jpg) |

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

Test media included in this repository may be subject to different licenses. See [LICENSES.md](LICENSES.md) for details on third-party content and attribution requirements.
