[← Back to Documentation](index.md)

# Installation

## Docker Compose

Create a `docker-compose.yml`. If you have one media directory with multiple subfolders, mount it to `/media`:

```yaml
services:
  app:
    image: ghcr.io/lumbar-spine-support/docker-haptic-player:latest
    ports:
      - "8069:3000"
    environment:
      PASSWORD: "change-me"
    volumes:
      - ./media:/media:ro # Audio, Video, Playlists, Funscripts (read-access)
      - ./config:/config # Persistent application settings (read/write access)
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
