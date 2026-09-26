[← Back to Table of Content](index.md)

# Authentication

HAPPY has a very simple authentication system. A single shared password. Nothing — not the page, not the JavaScript bundle, not the API — is served before you sign in. There are no user accounts. Not sure why you would need that for a porn stash...

Signing in stores an access token in an `HttpOnly` cookie and appends it to `tokens.txt` in the config directory. Because that directory is the `/config` mount, you stay signed in across container restarts and image upgrades. If the config directory is not writable, the server logs a `[tokens]` warning at startup and keeps sessions in memory only — login works, but every restart requires signing in again.

**To sign every device out, simply delete the token file:**

```bash
rm ./config/tokens.txt
```

This takes effect immediately, no restart needed. You can also open the settings panel and use *Sign out* to revoke only the current device.
