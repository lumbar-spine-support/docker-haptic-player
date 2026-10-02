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

export interface RouteHandlers {
    /** Runs before every route, e.g. to hide views that only one route shows. */
    before?(): void;
    tags(tags: string[]): void;
    docs(page: string): Promise<void>;
    player(trackId: string): Promise<void>;
    playlist(playlistId: string): Promise<void>;
    album(albumId: string): Promise<void>;
    library(): void;
    /** Absent when the sandbox is disabled; the route then falls back to the library. */
    dglabSandbox?(): void;
}

/** Maps the `?view=…&id=…&tag=…` query onto the app's views and follows history navigation. */
export class Router {
    constructor(private readonly handlers: RouteHandlers) { }

    /** Re-route on back/forward and run the current route. */
    start(): Promise<void> {
        window.addEventListener('popstate', () => { void this.handleRouteChange(); });
        return this.handleRouteChange();
    }

    navigateTo(url: string): void {
        history.pushState({}, '', url);
        void this.handleRouteChange();
    }

    isLibraryRoute(): boolean {
        return !new URLSearchParams(location.search).get('view');
    }

    async handleRouteChange(): Promise<void> {
        const params = new URLSearchParams(location.search);
        const view = params.get('view');
        const id = params.get('id');
        const tags = params.getAll('tag');
        this.handlers.before?.();
        if (tags.length > 0) this.handlers.tags(tags);
        if (view === 'docs') return this.handlers.docs(id || 'index');
        if (view === 'player' && id) return this.handlers.player(id);
        if (view === 'playlist' && id) return this.handlers.playlist(id);
        if (view === 'album' && id) return this.handlers.album(id);
        if (view === 'dglab-sandbox' && this.handlers.dglabSandbox) return this.handlers.dglabSandbox();
        this.handlers.library();
    }
}
