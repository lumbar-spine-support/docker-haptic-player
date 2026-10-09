[← Developer Guide](../README.md)

# Use case: Log in

**Goal:** a user opens HAPPY on a new device, signs in with their Jellyfin account and lands on the page they asked for.

There is exactly one sign-in: Jellyfin's. HAPPY keeps no accounts. The plugin serves the app (`/Happy/Web/`) and the docs (`/Happy/Docs`) without authentication, because the page has to show the sign-in card and neither holds media. The settings, the version, media, artwork and funscripts need the user's token.

## Sign in

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as App (index.ts)
  participant P as HAPPY plugin
  participant C as JellyfinConnection
  participant LS as localStorage
  participant J as Jellyfin

  U->>P: GET /Happy/Web/?view=player&id=abc
  P-->>A: index.html, app.js (anonymous)
  A->>A: jellyfinUrlFromPage(location.href)
  A->>C: new JellyfinConnection(serverUrl, reload)
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
  A->>P: GET /Happy/Config (token)
  P-->>A: ClientSettings
  A->>A: useJellyfin(), loadLibrary(), router.start()
  Note over A: the original URL is still in the address bar,<br/>so the requested page opens
```

| Situation | Behaviour |
| --- | --- |
| Page not served from `/Happy/Web/` | `jellyfinUrlFromPage()` returns `null`; `connectJellyfin()` shows `showMissingServerNotice()` and stops; nothing else loads |
| `/Happy/Config` fails | The client keeps its built-in defaults and logs a warning |
| Token rejected later (401) | `JellyfinConnection.request()` forgets the session and reloads; the sign-in card appears again |
| Session ended in Jellyfin (*Dashboard → Devices*) or user removed | The next request gets a 401, see above |
| Logout | The lock button runs `logout()` → `POST /Sessions/Logout` to Jellyfin, then a reload, which shows the card |
| Chromecast / AirPlay | The stream URL carries the Jellyfin token as `ApiKey`, so receivers need no sign-in of their own |
| Device list | `DeviceId` is a random id (`crypto.getRandomValues`, which also works on plain-HTTP origins) stored once per browser (`happy-jellyfin-device-id`), so Jellyfin lists one device per browser |

## DG-Lab relay

The [relay](../../../dglab-relay/README.md) is a separate process, so it checks the token with Jellyfin itself. `initDglab()` runs after the sign-in, so `CoyoteBackend` can hand the token to every relay connection.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (CoyoteBackend)
  participant D as createRelayServer (upgrade)
  participant V as jellyfinAuth verifier
  participant J as Jellyfin
  participant R as DglabRelay

  B->>D: upgrade …/ws/dglab<br/>Sec-WebSocket-Protocol: happy, jellyfin.TOKEN
  D->>D: no ?tid= → tokenFromProtocols()
  D->>V: verifyJellyfinToken(token)
  alt cached verdict
    V-->>D: valid / invalid
  else
    V->>J: GET /Users/Me (relay's JELLYFIN_URL)
    J-->>V: 200 / 401
    V-->>D: valid / invalid (cached 60 s / 5 s)
  end
  alt valid
    D->>R: handleUpgrade()
    R-->>B: 101, protocol "happy", then hello
  else invalid, missing or Jellyfin unreachable
    D-->>B: 401
  end
```

The relay's `handleProtocols` selects `happy`, so the token is never echoed in the handshake, and because it travels as a subprotocol it never appears in a URL or a log. DG-Lab apps connect with `?tid=` and no token; the unguessable `tid` is their credential (see [Pair a DG-Lab Coyote](coyote-pairing.md)).

## Code map

| Topic | Files |
| --- | --- |
| Session, sign-in, sign-out | [jellyfin/connection.ts](../../../src/client/jellyfin/connection.ts), [jellyfin/signIn.ts](../../../src/client/jellyfin/signIn.ts), [jellyfin/signIn.html](../../../src/client/jellyfin/signIn.html) |
| App wiring, logout button | [src/client/index.ts](../../../src/client/index.ts) (`connectJellyfin`, `bindLogout`), [jellyfin/serverUrl.ts](../../../src/client/jellyfin/serverUrl.ts), [src/client/api.ts](../../../src/client/api.ts) (`logout`, `fetchClientSettings`) |
| Anonymous app and docs | [WebController.cs](../../../jellyfin-plugin/Jellyfin.Plugin.Happy/Api/WebController.cs), [DocsController.cs](../../../jellyfin-plugin/Jellyfin.Plugin.Happy/Api/DocsController.cs) |
| Relay token check | [dglab-relay/src/server.ts](../../../dglab-relay/src/server.ts) (`createRelayServer`, `tokenFromProtocols`), [dglab-relay/src/jellyfinAuth.ts](../../../dglab-relay/src/jellyfinAuth.ts), [src/shared/dglab.ts](../../../src/shared/dglab.ts) |
| Relay side of the browser | [dglab/coyoteBackend.ts](../../../src/client/components/haptic/dglab/coyoteBackend.ts) |
| Tests | [dglab-relay/test/jellyfinAuth.test.ts](../../../dglab-relay/test/jellyfinAuth.test.ts), [dglab-relay/test/relay.test.ts](../../../dglab-relay/test/relay.test.ts), [test/integration/jellyfin/dglab.test.ts](../../../test/integration/jellyfin/dglab.test.ts) |
