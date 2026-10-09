/**
 * Jellyfin's address when the HAPPY plugin serves the app (`<jellyfin>/Happy/Web/`): everything before
 * that path, so a Jellyfin base URL such as `/jellyfin` is kept. Null when the page comes from elsewhere.
 */
export function jellyfinUrlFromPage(href: string): string | null {
    const url = new URL(href);
    // ASP.NET routes are case-insensitive, so the browser may show any casing.
    const match = url.pathname.match(/^(.*?)\/happy\/web(?:\/|$)/i);
    return match ? `${url.origin}${match[1]}` : null;
}

/** The page decides when the plugin serves it; otherwise the configured address (empty when there is none). */
export function resolveJellyfinUrl(configured: string, href: string): string {
    return jellyfinUrlFromPage(href) ?? configured.trim().replace(/\/+$/, '');
}
