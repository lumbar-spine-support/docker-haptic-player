# HAPPY ⸺ Jellyfin Haptic Player

![GitHub package.json version](https://img.shields.io/github/package-json/v/lumbar-spine-support/jellyfin-haptic-player?label=release)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/lumbar-spine-support/jellyfin-haptic-player/.github%2Fworkflows%2Ftest.yml?branch=main&logo=github&label=tests)
[![npm audit](https://img.shields.io/github/actions/workflow/status/lumbar-spine-support/jellyfin-haptic-player/npm-audit.yml?label=npm%20audit)](https://github.com/lumbar-spine-support/jellyfin-haptic-player/actions/workflows/npm-audit.yml)
![Codecov](https://img.shields.io/codecov/c/github/lumbar-spine-support/jellyfin-haptic-player)

![Preview](./docs/social.png)

**HAPPY** is **hap**tic **p**la**y**er for your existing Jellyfin library!

⭐ Key features:

- Easily added as a plugin to your [Jellyfin](https://jellyfin.org/) server.
- [Intiface](https://intiface.com/) websocket for wide-ranging haptic toys support.
- Modern [Video.JS v10](https://videojs.org/blog/videojs-v10-release-candidate) framework for audio and video playback.

🧪 Experimental features:

- [Dungeon Lab](https://www.dungeon-lab.com/) Coyote 3.0 E-stim haptic support
- Virtual Reality Rendering (VR180 SBS+TB)

🚀 Planned:

- [ ] Full VR Video support for headsets like the Steam Frame.
- [ ] Playlist/Queue editor and a seperate mount with write-access.


## Quick Start

### 1. Install the Jellyfin Plugin

In Jellyfin, open *Dashboard → Plugins → Repositories* and add HAPPY's plugin repository:

```
https://raw.githubusercontent.com/lumbar-spine-support/jellyfin-haptic-player/refs/heads/jellyfin-plugin-repository/manifest.json
```

Then install **HAPPY** from the plugin *Catalog* and restart Jellyfin. Jellyfin keeps the plugin up to date from now on. Open HAPPY at `<your Jellyfin address>/Happy/Web/` (or *Open HAPPY* on the plugin's settings page) and sign in with your Jellyfin account. Server-wide settings are on the plugin's settings page (*Dashboard → Plugins → HAPPY*).

→  [docs/installation.md](docs/installation.md), [docs/configuration.md](docs/configuration.md)

### 2. Library Setup

Put your funscripts next to the media files in your Jellyfin libraries:

```
audio/
├── audio.mp3
└── audio.vibrator.funscript
video/
├── video.mp4
└── video.stroker.funscript
```

→  [docs/library.md](docs/library.md)

### 3. Intiface Central (Required for Haptic Support)

Install [Intiface Central](https://intiface.com/#intiface-central). It is recommended to install it on the device you are using to listen/watch your files.

Once Intiface server is running and your toys are connected, find the IP-address of the device running Intiface. If you are running Intiface on the same device as your HAPPY client will be running (ideally your phone), you can leave the IP-address in HAPPY as `localhost`. Open the settings panel in HAPPY and enter the IP-address, then press connect. You should now see a list of your toys and their features. You can now assign individual features of each toy to a funscript.

→  [docs/intiface.md](docs/intiface.md)

### 4. DG-Lab Relay (Optional, for the Coyote 3.0)

The experimental DG-Lab Coyote support needs a small relay between HAPPY and the DG-Lab app. It ships as its own image; run it next to Jellyfin, then enable DG-Lab and enter the relay's address on the plugin's settings page.

```yaml
services:
  happy-dglab-relay:
    image: ghcr.io/lumbar-spine-support/happy-dglab-relay:latest
    ports:
      - "8070:8070"
    environment:
      JELLYFIN_URL: "http://jellyfin:8096" # Jellyfin as the relay reaches it
    restart: unless-stopped
```

→  [docs/dg-lab.md](docs/dg-lab.md#the-relay)

## Documentation

Note: All docs are also available in HAPPY itself (*Documentation* at the bottom of the settings panel).

- [Overview](docs/index.md)
- [Installation](docs/installation.md)
- [Intiface Central](docs/intiface.md)
- [DG-Lab Coyote 3.0 (experimental)](docs/dg-lab.md)
- [Library Setup](docs/library.md)
- [Configuration](docs/configuration.md)

## License

Copyright (c) 2025 jellyfin-haptic-player (HAPPY) contributors.

This project is licensed under the GNU General Public License v3.0 or later — see [LICENSE](LICENSE). Releases up to and including 0.12.0 were published under the MIT License.

Test media included in this repository may be subject to different licenses. See [LICENSES.md](LICENSES.md) for details on third-party content and attribution requirements.
