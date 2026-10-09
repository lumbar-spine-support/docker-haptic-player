# Third-Party Licenses

This project includes content and dependencies from various sources, each with their own licenses.

## Test Media

### Big Buck Bunny (CC BY 3.0)

**Files:** `test/fixtures/media/BigBuckBunny_320x180.mp4` and derivatives

**License:** [Creative Commons Attribution 3.0](http://creativecommons.org/licenses/by/3.0/)

**Copyright:** © 2008, Blender Foundation / www.bigbuckbunny.org

**Source:** https://www.bigbuckbunny.org/

**Attribution Requirements:**
When using or redistributing any files derived from Big Buck Bunny, you must include:
```
(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org
```

**Permitted Uses:**
- Educational purposes
- Testing and development
- Commercial redistribution (with attribution)
- Modification and re-distribution (with attribution)

**See Also:** [test/fixtures/media/ATTRIBUTION.md](test/fixtures/media/ATTRIBUTION.md) for detailed attribution information.

### NASA VR/360 Astronaut Training: Space Walk (Public Domain)

**Files:** `test/fixtures/media/NASA_VR360AstronautTraining_SpaceWalk.mp4`

**License:** Public domain in the United States (work of NASA, [PD-USGov-NASA](https://commons.wikimedia.org/wiki/Template:PD-USGov-NASA))

**Credit:** NASA, Public domain, via Wikimedia Commons

**Source:** https://commons.wikimedia.org/wiki/File:NASA_VR-360_Astronaut_Training-_Space_Walk.webm

**Note:** NASA logos and insignia remain restricted under 14 CFR 1221; their appearance does not imply endorsement.

---

## Vendored Front-End Libraries

These libraries are fetched from npm at build time by `scripts/copy-vendor-assets.js` and copied into
`public/vendor/` (not committed to Git; excluded via `.gitignore`), which the HAPPY Jellyfin plugin embeds together with the rest of the
client. They are listed here for completeness.

### Bootstrap

**License:** [MIT](https://github.com/twbs/bootstrap/blob/main/LICENSE)

**Copyright:** © 2011–2025 The Bootstrap Authors

**Source:** https://getbootstrap.com/

### Bootstrap Icons

**License:** [MIT](https://github.com/twbs/icons/blob/main/LICENSE)

**Copyright:** © 2019–2024 The Bootstrap Authors

**Source:** https://icons.getbootstrap.com/

### @videojs/html (Video.js v10)

**License:** [Apache License 2.0](https://github.com/videojs/video.js/blob/main/LICENSE)

**Copyright:** © 2010–present Video.js contributors

**Source:** https://videojs.org/

---

## DG-Lab Relay Dependencies

### ws

**License:** [MIT](https://github.com/websockets/ws/blob/master/LICENSE)

**Copyright:** © 2011–2024 Einar Otto Stangvik and contributors

**Source:** https://github.com/websockets/ws

Bundled into the DG-Lab relay image (`dglab-relay/`) as its WebSocket server.

---

## Client Dependencies

### dglab-kit

**License:** [GPL-3.0](https://github.com/dungeonlab-open/dglab-kit/blob/main/LICENSE)

**Source:** https://github.com/dungeonlab-open/dglab-kit

Bundled into `public/js/app.js` as the DG-Lab V4 client. HAPPY's DG-Lab relay (`dglab-relay/`) is its own implementation.

### eventemitter3

**License:** [MIT](https://github.com/primus/eventemitter3/blob/master/LICENSE)

**Copyright:** © 2014 Arnout Kazemier

**Source:** https://github.com/primus/eventemitter3

Dependency of dglab-kit.

---

## Project License

Copyright (c) 2025 docker-haptic-player (HAPPY) contributors.

This project is licensed under the GNU General Public License v3.0 or later — see [LICENSE](LICENSE). Releases up to and including 0.12.0 were published under the MIT License.
