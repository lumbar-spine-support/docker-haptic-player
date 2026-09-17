let nextInstanceId = 0;

/**
 * Registers an ejected skin template (`skin.html`) as a light-DOM custom element so pages can swap skins by tag name.
 * `{{iid}}` placeholders baked into every id/trigger/commandfor pair are substituted with a unique per-instance token
 * before parsing, so multiple instances of the same skin on one page don't collide via getElementById.
 * The element's original children are split: the `<video>`/`<audio>` is moved to the front of the skin's
 * `media-container` (required for playback), while everything else (e.g. `<media-title>`) is appended to the end,
 * so vendor CSS patterns like `media-controls[data-visible] ~ media-title` see the expected sibling order.
 */
export function defineSkin(tagName: string, skinHTML: string): void {
  if (customElements.get(tagName)) return;

  customElements.define(
    tagName,
    class extends HTMLElement {
      connectedCallback(): void {
        if (this.querySelector(':scope > media-container')) return;

        const original = Array.from(this.childNodes);
        const mediaElements = original.filter((node): node is HTMLMediaElement => node instanceof HTMLMediaElement);
        const extras = original.filter((node) => !mediaElements.includes(node as HTMLMediaElement));

        const template = document.createElement('template');
        template.innerHTML = skinHTML.replace(/\{\{iid\}\}/g, String(nextInstanceId++));
        const skin = template.content;

        const container = skin.querySelector('media-container');
        container?.prepend(...mediaElements);
        container?.append(...extras);
        this.append(skin);
      }
    },
  );
}