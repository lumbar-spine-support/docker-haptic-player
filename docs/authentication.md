[← Back to Table of Content](index.md)

# Authentication

## Jellyfin sign-in

Your media, artwork and funscripts come from Jellyfin, so HAPPY asks you to sign in with your **Jellyfin user name and password**. You only see the libraries that user can access in Jellyfin, and the HAPPY plugin only hands out funscripts of those items. Users are managed in Jellyfin.

The sign-in is remembered in the browser. Each browser shows up once in Jellyfin under *Dashboard → Devices*, where you can also end its session. *Sign out* in HAPPY's settings panel ends the session in Jellyfin as well.

## HAPPY password (optional)

On top of that, HAPPY guards its own page with a single shared password (`PASSWORD`, default `happy`). While it is set, nothing — not the page, not the JavaScript bundle, not the API — is served before you enter it. Set `PASSWORD` to an empty string to rely on the Jellyfin sign-in alone.

Entering the password stores an access token in an `HttpOnly` cookie and appends it to `tokens.txt` in the config directory. Because that directory is the `/config` mount, you stay signed in across container restarts and image upgrades. If the config directory is not writable, the server logs a `[tokens]` warning at startup and keeps sessions in memory only — login works, but every restart requires entering the password again.

**To sign every device out of HAPPY's password gate, simply delete the token file:**

```bash
rm ./config/tokens.txt
```

This takes effect immediately, no restart needed. *Sign out* in the settings panel revokes only the current device.
