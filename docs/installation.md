[← Back to Documentation](index.md)

# Installation

## Docker Compose

Create a `docker-compose.yml`. If you have one media directory with multiple subfolders, mount it to `/media`:

```yaml
services:
  happy:
    image: ghcr.io/lumbar-spine-support/docker-haptic-player:stable
    ports:
      - "8069:8069"
    environment:
      PASSWORD: "happy"
      PORT: 8069
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

Start the app with `docker compose up -d`. After a few seconds it is reachable at `http://<HOST>:8069`.

On first start a `settings.yaml` is created in the `/config` mount. See [Configuration](configuration.md).

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

## Running behind a reverse proxy

*TODO*