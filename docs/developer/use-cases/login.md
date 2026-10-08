[← Developer Guide](../README.md)

# Use case: Log in

**Goal:** a user opens HAPPY on a new device, signs in and lands on the page they asked for.

There are two sign-ins:

1. **HAPPY's password** (`PASSWORD`) guards the HAPPY page itself. It is on when `PASSWORD` is not empty. With an empty password, every request to the HAPPY server is allowed and `/api/auth/status` reports `required: false`.
2. **The Jellyfin sign-in** gives access to media, artwork and funscripts. It always applies.

## Jellyfin sign-in

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as App (index.ts)
  participant C as JellyfinConnection
  participant LS as localStorage
  participant J as Jellyfin

  A->>C: new JellyfinConnection(jellyfinUrl, reload)
  C->>LS: happy-jellyfin-session
  alt stored session for this server
    LS-->>C: token, userId, userName
  else none
    A->>U: ensureSignedIn(): sign-in card
    U->>A: user name, password
    A->>C: signIn()
    C->>J: POST /Users/AuthenticateByName<br/>Authorization: MediaBrowser Client, Device, DeviceId, Version
    alt 200
      J-->>C: AccessToken, User
      C->>LS: store session
    else 401 / unreachable
      J-->>C: error
      C-->>A: JellyfinSignInError, card shows the message
    end
  end
  A->>A: useJellyfin(), loadLibrary()
```

| Situation | Behaviour |
| --- | --- |
| Token rejected later (401) | `JellyfinConnection.request()` forgets the session and reloads; the card appears again |
| Logout | `logout()` → `POST /Sessions/Logout` to Jellyfin, then HAPPY's own logout when `PASSWORD` is on, otherwise a reload |
| Chromecast / AirPlay | The stream URL carries the Jellyfin token as `api_key`, so receivers need no cookie |
| Device list | `DeviceId` is a random id stored once per browser (`happy-jellyfin-device-id`), so Jellyfin lists one device per browser |

## HAPPY password: happy path

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant B as Browser
  participant MW as Auth middleware
  participant AR as Auth router
  participant TS as tokenStore<br/>tokens.txt

  U->>B: open /?view=player&id=abc
  B->>MW: GET /?view=player&id=abc (no cookie)
  MW-->>B: 302 → /auth/?returnTo=original URL
  B->>MW: GET /auth/ (public prefix)
  MW-->>B: login page + login.js
  B->>AR: GET /api/auth/status
  AR-->>B: required: true, authenticated: false
  U->>B: type password, submit
  B->>AR: POST /api/auth/login password
  AR->>AR: loginThrottle: not blocked
  AR->>AR: timing-safe compare
  AR->>TS: issue(user agent)
  TS->>TS: append "token timestamp label", mode 0600
  TS-->>AR: token
  AR-->>B: 200, Set-Cookie happy_token (httpOnly, SameSite=Lax, 10 years)
  B->>B: safeReturnTo(): only same-origin paths
  B->>MW: GET /?view=player&id=abc (cookie)
  MW->>TS: verify(token)
  TS-->>MW: valid
  MW-->>B: app
```

## HAPPY password: other paths

```mermaid
flowchart TD
  Submit(["POST /api/auth/login"]) --> Blocked{"IP blocked?"}
  Blocked -- yes --> R429["429 + Retry-After<br/>login page counts down"]
  Blocked -- no --> Match{"password matches?"}
  Match -- no --> Fail["recordFailure(ip)"] --> Five{"5th failure?"}
  Five -- no --> R401["401 Invalid password"]
  Five -- yes --> Block["block for 60 s × 2^(n-1),<br/>max 15 min"] --> R401
  Match -- yes --> Reset["reset(ip)"] --> Issue["issue token, set cookie"] --> R200["200"]
```

| Situation | Behaviour |
| --- | --- |
| Already signed in and opens `/auth/` | `skipIfSignedIn()` sees `authenticated: true` and redirects to `returnTo` |
| An API call returns 401 later (token revoked) | `handleUnauthorized()` in `api.ts` redirects to `/auth/?returnTo=…` once |
| Logout | Jellyfin sign-out first, then `POST /api/auth/logout` → `tokenStore.revoke(token)` + clear cookie → login page |
| Admin revokes a device | Delete its line from `tokens.txt`. The store re-reads the file when its mtime changes |
| DG-Lab relay | The browser's WebSocket upgrade carries the cookie. The app side uses the unguessable `tid` instead. See [Pair a DG-Lab Coyote](coyote-pairing.md) |

## Code map

| Step | Files |
| --- | --- |
| Gatekeeping | [middleware/auth.ts](../../../src/server/middleware/auth.ts) |
| Login, logout, status | [routes/auth.ts](../../../src/server/routes/auth.ts), [middleware/loginThrottle.ts](../../../src/server/middleware/loginThrottle.ts) |
| Token persistence | [services/tokenStore.ts](../../../src/server/services/tokenStore.ts) |
| Login page | [src/client/login.ts](../../../src/client/login.ts), [public/auth/index.html](../../../public/auth/index.html) |
| 401 handling in the app | [src/client/api.ts](../../../src/client/api.ts) |
| Jellyfin sign-in | [jellyfin/connection.ts](../../../src/client/jellyfin/connection.ts), [jellyfin/signIn.ts](../../../src/client/jellyfin/signIn.ts), [src/client/index.ts](../../../src/client/index.ts) (`connectJellyfin`, `bindLogout`) |
