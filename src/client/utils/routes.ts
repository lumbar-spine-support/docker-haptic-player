export function buildUrl(route: string, id?: string, tags?: readonly string[]): string {
    const params = new URLSearchParams();
    if (route !== 'library') params.set('view', route);
    if (id) params.set('id', id);
    if (tags && tags.length > 0) tags.forEach((t) => params.append('tag', t));
    const query = params.toString();
    const basePath = new URL('.', window.location.href).pathname;
    const path = basePath === '/' ? '/' : basePath.replace(/\/+$/, '/');
    return query ? `${path}?${query}` : path;
}

export function trackHref(trackId: string): string {
    return buildUrl('player', trackId);
}

export function detailHref(type: 'playlist' | 'album', id: string): string {
    return buildUrl(type, id);
}
