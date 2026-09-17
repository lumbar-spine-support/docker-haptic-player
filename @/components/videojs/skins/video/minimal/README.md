# Modified Video.JS Minimal Skin

The minimal skin was ejected as described in the [docs](https://videojs.org/docs/framework/html/how-to/customize-skins) to be able to add loop and playlist-buttons (back/forward) etc.

## Update the ejected skin

We can update the ejected skin by calling

```bash
npx shadcn@latest add @videojs/video-minimal --overwrite
```

and checking the diffs in Git and reintegrate our custom changes in the updated skin.

## List of custom changes

- `skin.html`
  - Add custom buttons
- `skin.ts`
  - Replace most of the native video.js buttons with Bootstrap icons for a more streamlined UI
