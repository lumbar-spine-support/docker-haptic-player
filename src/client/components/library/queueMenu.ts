/** What the library's queue menus can ask of the playback queue; the app provides it. */
export interface QueueActions {
    playNext(trackIds: string[]): void;
    enqueue(trackIds: string[]): void;
}

let actions: QueueActions | null = null;

/** Publishes the object every queue menu drives. */
export function setQueueActions(next: QueueActions | null): void {
    actions = next;
}

/**
 * "⋯" dropdown with "Play next" and "Add to queue" for a card, a list row or a
 * row of the album/playlist page. `trackIds` is read on click, so a menu always
 * queues what its item holds at that moment.
 */
export function createQueueMenu(trackIds: () => string[], label: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dropdown queue-menu';
    // Cards and rows open their item on click; the menu must not.
    wrapper.addEventListener('click', (event) => event.stopPropagation());

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-link btn-sm p-0 lh-1 queue-menu-toggle';
    toggle.dataset.bsToggle = 'dropdown';
    // Fixed positioning keeps the menu from being clipped by the table or card grid.
    toggle.dataset.bsPopperConfig = '{"strategy":"fixed"}';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', `Queue options for ${label}`);
    toggle.title = 'Queue options';
    toggle.innerHTML = '<i class="bi bi-three-dots-vertical" aria-hidden="true"></i>';

    const menu = document.createElement('ul');
    menu.className = 'dropdown-menu dropdown-menu-end';
    // The wrapper keeps clicks from the card or row, and so from Bootstrap's
    // close-on-click handler too: close the menu here.
    const choose = (action: () => void) => () => {
        action();
        window.bootstrap?.Dropdown.getInstance(toggle)?.hide();
    };
    menu.appendChild(menuItem('bi-skip-end-fill', 'Play next', choose(() => actions?.playNext(trackIds()))));
    menu.appendChild(menuItem('bi-plus-lg', 'Add to queue', choose(() => actions?.enqueue(trackIds()))));
    wrapper.appendChild(toggle);
    wrapper.appendChild(menu);
    return wrapper;
}

/** `icon` and `text` are fixed strings from this module, never user data. */
function menuItem(icon: string, text: string, onClick: () => void): HTMLLIElement {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dropdown-item d-flex align-items-center gap-2';
    button.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>${text}`;
    button.addEventListener('click', onClick);
    li.appendChild(button);
    return li;
}
