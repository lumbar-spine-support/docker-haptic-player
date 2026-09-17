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

---

## Vendored Front-End Libraries

These libraries are fetched from npm at build time by `scripts/copy-vendor-assets.js` and copied into
`public/vendor/` (not committed to Git; excluded via `.gitignore`). They are listed here for completeness.

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

## Project License

This project itself is licensed under the [MIT License](LICENSE).

The MIT license applies to the source code. Included test media may have different licenses as documented above.
