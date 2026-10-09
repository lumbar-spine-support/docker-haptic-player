import { setJellyfinFavorite } from '../../api';
import { notifyFavoriteChanged } from '@/components/videojs/features/favorite';

/** A Jellyfin item that carries the user's favorite flag: a track, video or playlist. */
export interface FavoriteItem {
    id: string;
    isFavorite: boolean;
}

const targets = new WeakMap<HTMLButtonElement, FavoriteItem>();
const pending = new Set<string>();

/** Shows `favorite` on one button: filled heart, pressed state and a matching title. */
export function renderFavoriteButton(button: HTMLButtonElement, favorite: boolean): void {
    button.setAttribute('aria-pressed', String(favorite));
    button.classList.toggle('is-favorite', favorite);
    const label = favorite ? 'Remove from favorites' : 'Add to favorites';
    button.title = label;
    if (!button.querySelector('[data-favorite-label]')) button.setAttribute('aria-label', label);
    const icon = button.querySelector('i');
    icon?.classList.toggle('bi-heart-fill', favorite);
    icon?.classList.toggle('bi-heart', !favorite);
}

/** Every button for the same item (card, row, player, playlist page) shows the same state. */
function renderAll(item: FavoriteItem): void {
    notifyFavoriteChanged();
    document.querySelectorAll<HTMLButtonElement>('button[data-favorite-id]').forEach((button) => {
        if (button.dataset.favoriteId === item.id) renderFavoriteButton(button, item.isFavorite);
    });
}

/**
 * Flips the item's favorite flag in Jellyfin. The UI updates at once and reverts when Jellyfin
 * refuses; clicks while a request for the same item is in flight are ignored.
 */
export async function toggleFavorite(item: FavoriteItem): Promise<void> {
    if (pending.has(item.id)) return;
    pending.add(item.id);
    const previous = item.isFavorite;
    item.isFavorite = !previous;
    renderAll(item);
    try {
        item.isFavorite = await setJellyfinFavorite(item.id, !previous);
    } catch (err) {
        item.isFavorite = previous;
        console.error('[favorites] Jellyfin did not store the favorite', err);
    } finally {
        pending.delete(item.id);
        renderAll(item);
    }
}

/** Points a button at an item, or hides it for `null`. Wires the click handler on first use. */
export function bindFavoriteButton(button: HTMLButtonElement, item: FavoriteItem | null): void {
    if (!button.dataset.favoriteBound) {
        button.dataset.favoriteBound = 'true';
        button.addEventListener('click', (event) => {
            // Cards and rows open the item on click; the heart must not.
            event.preventDefault();
            event.stopPropagation();
            const target = targets.get(button);
            if (target) void toggleFavorite(target);
        });
    }
    if (!item) {
        targets.delete(button);
        delete button.dataset.favoriteId;
        button.classList.add('d-none');
        return;
    }
    targets.set(button, item);
    button.dataset.favoriteId = item.id;
    button.classList.remove('d-none');
    renderFavoriteButton(button, item.isFavorite);
}

/** A compact heart button for cards and list rows. */
export function createFavoriteButton(item: FavoriteItem): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-link btn-sm p-0 lh-1 favorite-btn';
    const icon = document.createElement('i');
    icon.className = 'bi bi-heart';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    bindFavoriteButton(button, item);
    return button;
}
