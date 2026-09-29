[← Developer Guide](../README.md)

# Use case: Log in

**Goal:** a user opens HAPPY on a new device, enters the password and lands on the page they asked for.

Authentication is on when `PASSWORD` is not empty. With an empty password, every request is allowed and `/api/auth/status` reports `required: false`.

## Happy path

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

## Other paths

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
| An API call returns 401 later (token revoked) | `handleUnauthorized()` in `utils/api.ts` redirects to `/auth/?returnTo=…` once |
| Logout | `POST /api/auth/logout` → `tokenStore.revoke(token)` + clear cookie → login page |
| Admin revokes a device | Delete its line from `tokens.txt`. The store re-reads the file when its mtime changes |
| Chromecast / AirPlay | No cookie. `/api/config` hands out a per-process `mediaAccessToken`, which `mediaUrl()` appends as `?mediaToken=`. It only unlocks `GET`/`HEAD` on `/api/media/*` |
| DG-Lab relay | The browser's WebSocket upgrade carries the cookie. The app side uses the unguessable `tid` instead. See [Pair a DG-Lab Coyote](coyote-pairing.md) |

## Code map

| Step | Files |
| --- | --- |
| Gatekeeping | [middleware/auth.ts](../../../src/server/middleware/auth.ts) |
| Login, logout, status | [routes/auth.ts](../../../src/server/routes/auth.ts), [middleware/loginThrottle.ts](../../../src/server/middleware/loginThrottle.ts) |
| Token persistence | [services/tokenStore.ts](../../../src/server/services/tokenStore.ts) |
| Login page | [src/client/login.ts](../../../src/client/login.ts), [public/auth/index.html](../../../public/auth/index.html) |
| 401 handling in the app | [src/client/utils/api.ts](../../../src/client/utils/api.ts) |
