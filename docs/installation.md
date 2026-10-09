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

HAPPY has no accounts of its own: who may see what is decided by Jellyfin's users and their library access, see [Authentication](authentication.md).

The HAPPY server itself only contacts Jellyfin to check sign-ins for the DG-Lab relay. If the HAPPY container reaches Jellyfin at a different address than your browser does (for example `http://jellyfin:8096` on a shared Docker network), set `JELLYFIN_INTERNAL_URL` to that address.

## Jellyfin plugin

The plugin indexes `.funscript` files that sit next to your media and serves them to signed-in Jellyfin users. Without it HAPPY still plays your media, but without haptics.

### From the HAPPY plugin repository (recommended)

Add HAPPY's plugin repository to Jellyfin once. After that Jellyfin installs the plugin from its catalog and keeps it up to date like any official plugin.

1. In Jellyfin, open *Dashboard → Plugins → Repositories* and add a repository:
   - Name: `HAPPY`
   - URL: `https://raw.githubusercontent.com/lumbar-spine-support/docker-haptic-player/jellyfin-plugin-repository/manifest.json`
2. Open the plugin *Catalog*, select **HAPPY** (category *General*) and install it.
3. Restart Jellyfin. *Dashboard → Plugins* now lists **HAPPY**.
4. Run a library scan, or just open HAPPY; the funscript index is built on first use and refreshed after every scan.

Jellyfin checks its repositories for updates every day (the *Update Plugins* scheduled task) and installs new versions automatically; restart Jellyfin to load an update. You can turn automatic updates off on the plugin's page. Jellyfin only offers plugin versions built for its own version or an older one.

### By hand

1. Download `happy_<version>.zip` from a [HAPPY release](https://github.com/lumbar-spine-support/docker-haptic-player/releases) and unzip it into a new folder `HAPPY_<version>` (it contains `Jellyfin.Plugin.Happy.dll` and `meta.json`). Each CI build also uploads the folder as the `jellyfin-plugin-happy` artifact; to build it yourself, run `sh jellyfin-plugin/package.sh` with the .NET 10 SDK, which writes `jellyfin-plugin/artifacts/HAPPY_<version>/`.
2. Copy that folder into the `plugins` directory of Jellyfin's data directory (for the official Docker image that is `/config/plugins/` inside Jellyfin's config volume).
3. Restart Jellyfin and continue with step 4 above.

The plugin is built for one Jellyfin version (currently 12.1). After a Jellyfin upgrade, install the matching plugin version; with the repository added, Jellyfin does that for you once a matching version is released.

## Running without Docker

If you want to avoid docker, you can install with `npm` and run the server using `node`.
However, unless you are doing development, this is not recommended.

```shell
npm install
npm run build
JELLYFIN_URL="https://jellyfin.example.com" node dist/server/index.js
```

The server should be reachable at `http://localhost:3000`. To adjust settings, you need to use environment variables in your terminal context. See [docs/configuration.md](configuration.md).
