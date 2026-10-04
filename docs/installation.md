[← Back to Table of Content](index.md)

# Installation

## Docker Compose

Create a `docker-compose.yml`. If you have one media directory with multiple subfolders, mount it to `/media`:

```yaml
services:
  happy:
    image: ghcr.io/lumbar-spine-support/docker-haptic-player:stable
    ports:
      - "8069:3000" # host:container
    environment:
      PASSWORD: "happy"
    volumes:
      - ./media:/media:ro
      - ./config:/config # write-access required
    restart: unless-stopped
```

To mount multiple folders, mount them as subfolders of `/media`. HAPPY does not care how the media is sorted; it connects media files with descriptions and funscripts by name only.

```yaml
volumes:
  - ./media/audio:/media/audio:ro
  - ./media/video:/media/video:ro
  - ./media/playlists:/media/playlists:ro
  - ./config:/config # write-access required
```

Start the app with `docker compose up`. After a few seconds it is reachable at `http://<HOST>:8069`.
To populate your library with actual media, see [docs/library.md](library.md)

On first start a `settings.yaml` is created in the `/config` mount. You may also pass those settings as environment variables to the Docker container as shown in the example above using `PASSWORD`. To change the port, change the host side of the port mapping; `PORT` is only needed when running with host networking. The image has a built-in health check, so `docker ps` shows the container as `healthy` once it answers requests. See [Configuration](configuration.md) for details on each setting.

## Running without Docker

If you want to avoid docker, you can install with `npm` and run the server using `node`.
However, unless you are doing development, this is not recommended.
[FFmpeg](https://ffmpeg.org/) (`ffprobe` and `ffmpeg`) must be on the `PATH`; it is used to read metadata, chapters and cover art.

```shell
npm install
node dist/server/index.js
```

The server should be reachable at `http://localhost:3000`. To adjust settings, you need to use environment variables in your terminal context. See [docs/configuration.md](configuration.md).
