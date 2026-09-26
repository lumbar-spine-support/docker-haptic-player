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

## Quick Start

### 1. Intiface Central

Install [Intiface Central](https://intiface.com/#intiface-central), press the big "play" button to start its server, then "start scan" to find your toys.

→ Details: [docs/intiface.md](docs/intiface.md)

### 2. Docker Compose

```yaml
services:
  app:
    image: ghcr.io/lumbar-spine-support/docker-haptic-player:latest
    ports:
      - "8069:3000"
    environment:
      PASSWORD: "change-me"
    volumes:
      - ./media:/media:ro
      - ./config:/config
    restart: unless-stopped
```

Run `docker compose up -d` and open `http://<HOST>:8069`.

→ Details: [docs/installation.md](docs/installation.md), [docs/configuration.md](docs/configuration.md)

### 3. Media Library

Put your files into `./media`. Funscripts and optional descriptions are matched by file name:

```
media/
├── video.mp4
├── video.stroker.funscript
├── video.md               (optional: tags, description)
└── playlists/favorites.m3u
```

→ Details: [docs/library.md](docs/library.md)

### 4. Connect

Open the settings panel in HAPPY, press **Connect** to reach Intiface and assign your toys to the file's funscripts.

## Documentation

All docs are also built into the app at `http://<HOST>:8069/docs`.

- [Overview](docs/index.md)
- [Installation](docs/installation.md)
- [Intiface Central](docs/intiface.md)
- [DG-Lab Coyote 3.0 (experimental)](docs/dg-lab.md)
- [Library Setup](docs/library.md)
- [Configuration](docs/configuration.md)

## Planned Features

- [ ] Video.JS player improvements
  - [ ] Funscript chapters shown in Video.JS player for navigation.
  - [ ] VR Video support once Video.JS v10 matures.
- [ ] Playlist editor and a seperate mount with write-access.

## Screenshots

| Library View                                    | Player View                                   |
| ----------------------------------------------- | --------------------------------------------- |
| ![Library Screenshot](docs/screenshots/library.jpg) | ![Player Screenshot](docs/screenshots/player.jpg) |

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

Test media included in this repository may be subject to different licenses. See [LICENSES.md](LICENSES.md) for details on third-party content and attribution requirements.
