# Documentation

- [Installation](installation.md) — Docker Compose, volumes, authentication, reverse proxy
- [Intiface Central](intiface.md) — connecting haptic toys
- [DG-Lab Coyote 3.0](dg-lab.md) — experimental direct support
- [Library Setup](library.md) — file layout, funscripts, playlists, tags and descriptions
- [Configuration](configuration.md) — `settings.yaml`, environment variables, logging

## Overview

```mermaid
flowchart LR
  Media[(Media Volume)]
  Client[HAPPY\nClient]
  HAPPY[HAPPY\nServer]
  Intiface[Intiface\nCentral]
  Toys[Haptic\nPeripherals]
  DGLab[DG-Lab 4\nApp]
  Coyote[DG-Lab\nCoyote 3.0]

  Client -->|GET-API| HAPPY
  HAPPY -->|Serves| Client
  Client <-->|Buttplug.io-API| Intiface
  Intiface -->|Bluetooth / USB| Toys
  Media -->|Docker Mount| HAPPY
  Client <-.->|DG-Lab Relay\nWebSocket| HAPPY
  HAPPY <-.->|DG-Lab Relay\nWebSocket| DGLab
  DGLab -.->|Bluetooth| Coyote
```
