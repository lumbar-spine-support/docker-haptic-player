[← Back to Table of Content](index.md)

# Installation

HAPPY plays media from a [Jellyfin](https://jellyfin.org/) server. Jellyfin scans your files and provides metadata, artwork, chapters, timeline thumbnails, users and streaming; the HAPPY plugin for Jellyfin adds the funscripts. HAPPY itself runs as a separate container and never reads your media folders.

You need:

1. A Jellyfin server your browser can reach, with your audio and video in its libraries (see [Media Library](library.md)).
2. The HAPPY plugin installed in that Jellyfin server (below).
3. The HAPPY container, pointed at Jellyfin with `JELLYFIN_URL`.

## Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  happy:
    image: ghcr.io/lumbar-spine-support/docker-haptic-player:stable
    ports:
      - "8069:3000" # host:container
    environment:
      JELLYFIN_URL: "https://jellyfin.example.com"
    volumes:
      - ./config:/config # write-access required
    restart: unless-stopped
```

`JELLYFIN_URL` is the address of the Jellyfin server **as your browser reaches it**: the browser loads the library and streams directly from Jellyfin, not through HAPPY. Use the same address you open Jellyfin's own web interface with. If Jellyfin is served over HTTPS, serve HAPPY over HTTPS too, because browsers block requests from an HTTPS page to a plain HTTP one.

Start the app with `docker compose up`. After a few seconds it is reachable at `http://<HOST>:8069`. Sign in with your Jellyfin user name and password; HAPPY shows the libraries that user can see in Jellyfin.

On first start a `settings.yaml` is created in the `/config` mount. You may also pass those settings as environment variables to the Docker container as shown above with `JELLYFIN_URL`. To change the port, change the host side of the port mapping; `PORT` is only needed when running with host networking. The image has a built-in health check, so `docker ps` shows the container as `healthy` once it answers requests. See [Configuration](configuration.md) for details on each setting.

HAPPY additionally guards its own page with `PASSWORD`, which defaults to `happy`. Set it to an empty string to rely on the Jellyfin sign-in alone; see [Authentication](authentication.md).

## Jellyfin plugin

The plugin indexes `.funscript` files that sit next to your media and serves them to signed-in Jellyfin users. Without it HAPPY still plays your media, but without haptics.

To install it by hand:

1. Get the plugin folder `HAPPY_<version>` (it contains `Jellyfin.Plugin.Happy.dll` and `meta.json`). Each CI build uploads it as the `jellyfin-plugin-happy` artifact; to build it yourself, run `sh jellyfin-plugin/package.sh` with the .NET 10 SDK, which writes `jellyfin-plugin/artifacts/HAPPY_<version>/`.
2. Copy that folder into the `plugins` directory of Jellyfin's data directory (for the official Docker image that is `/config/plugins/` inside Jellyfin's config volume).
3. Restart Jellyfin. *Dashboard → Plugins* now lists **HAPPY**.
4. Run a library scan, or just open HAPPY; the funscript index is built on first use and refreshed after every scan.

The plugin is built for one Jellyfin version (currently 12.1). After a Jellyfin upgrade, install the matching plugin version.

## Running without Docker

If you want to avoid docker, you can install with `npm` and run the server using `node`.
However, unless you are doing development, this is not recommended.

```shell
npm install
npm run build
JELLYFIN_URL="https://jellyfin.example.com" node dist/server/index.js
```

The server should be reachable at `http://localhost:3000`. To adjust settings, you need to use environment variables in your terminal context. See [docs/configuration.md](configuration.md).
