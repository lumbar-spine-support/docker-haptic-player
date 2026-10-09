import { UIElement } from '@videojs/html';
import { applyElementProps, createButton } from '@videojs/core/dom';
import { TRACK_ID_ATTRIBUTE } from '../features/favorite';
import { getQueueTarget, subscribeQueue, upcomingOf, type QueueItem, type QueueState } from '../features/queue';
import './queue.css';

/**
 * Add-to-queue button.
 *
 * Queues the track its own `<video-player>` holds. Hidden while that player
 * holds the playing track (it is the queue's current entry already); shows a
 * check once the track is up next.
 *
 * https://videojs.org/docs/framework/html/how-to/build-your-own-component
 */
class QueueAddButtonElement extends UIElement {
    static readonly tagName = 'media-queue-add-button';

    #disconnect: AbortController | null = null;
    #unsubscribe: (() => void) | null = null;
    #observer: MutationObserver | null = null;
    #player: HTMLElement | null = null;

    private get trackId(): string | null {
        return this.#player?.getAttribute(TRACK_ID_ATTRIBUTE) ?? null;
    }

    private get place(): 'current' | 'upcoming' | null | undefined {
        const id = this.trackId;
        const target = getQueueTarget();
        return id && target ? target.placeOf(id) : undefined;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#disconnect = new AbortController();
        this.#player = this.closest<HTMLElement>('video-player');
        applyElementProps(this, createButton({
            onActivate: () => this.#activate(),
            isDisabled: () => this.place !== null,
        }), { signal: this.#disconnect.signal });
        this.#unsubscribe = subscribeQueue(() => this.requestUpdate());
        if (this.#player) {
            this.#observer = new MutationObserver(() => this.requestUpdate());
            this.#observer.observe(this.#player, { attributes: true, attributeFilter: [TRACK_ID_ATTRIBUTE] });
        }
    }

    override disconnectedCallback(): void {
        this.#disconnect?.abort();
        this.#disconnect = null;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#observer?.disconnect();
        this.#observer = null;
        this.#player = null;
        super.disconnectedCallback();
    }

    protected override update(changed: Map<string, unknown>): void {
        super.update(changed);
        const place = this.place;
        const queued = place === 'upcoming';
        this.toggleAttribute('data-hidden', place === undefined || place === 'current');
        this.setAttribute('aria-disabled', String(queued));
        this.setAttribute('aria-label', queued ? 'In queue' : 'Add to queue');
        this.toggleAttribute('data-active', queued);
        this.querySelector('media-icon')?.setAttribute('name', queued ? 'check' : 'queue-add');
    }

    #activate(): void {
        const id = this.trackId;
        if (id && this.place === null) getQueueTarget()?.enqueue(id);
    }
}

/**
 * Contents of the queue popover: what played, what plays now and what is up
 * next. Upcoming entries can be dragged by their handle (or moved with
 * Alt+↑/↓), removed, shuffled and cleared; any entry can be played.
 *
 * Also hides its popover's trigger while the queue is empty.
 */
class QueuePanelElement extends UIElement {
    static readonly tagName = 'media-queue-panel';

    #unsubscribe: (() => void) | null = null;
    #resize: ResizeObserver | null = null;
    #showHistory = false;
    /** Re-rendering mid-drag would drop the row being dragged. */
    #dragging = false;
    #list: HTMLOListElement | null = null;

    override connectedCallback(): void {
        super.connectedCallback();
        if (!this.#list) this.#build();
        this.#unsubscribe = subscribeQueue(() => this.requestUpdate());
        // The popover sits in the top layer, so hiding its player (browsing another
        // page) or its trigger (empty queue) would leave it floating; close it instead.
        const trigger = this.#trigger();
        if (trigger) {
            this.#resize = new ResizeObserver(() => {
                const popover = this.closest<HTMLElement & { open?: boolean }>('media-popover');
                if (popover?.open && !trigger.offsetWidth) popover.open = false;
            });
            this.#resize.observe(trigger);
        }
    }

    override disconnectedCallback(): void {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#resize?.disconnect();
        this.#resize = null;
        super.disconnectedCallback();
    }

    protected override update(changed: Map<string, unknown>): void {
        super.update(changed);
        const state = getQueueTarget()?.getState() ?? null;
        this.#trigger()?.toggleAttribute('data-hidden', !state?.items.length);
        if (!this.#dragging) this.#render(state);
    }

    #trigger(): HTMLElement | null {
        const popover = this.closest<HTMLElement>('media-popover');
        if (!popover?.id) return null;
        return popover.parentElement?.querySelector<HTMLElement>(`[commandfor="${popover.id}"]`) ?? null;
    }

    #build(): void {
        this.innerHTML = `
            <div class="media-queue-header">
                <div class="media-queue-heading">
                    <span class="media-queue-title">Queue</span>
                    <span class="media-queue-source" data-part="source"></span>
                </div>
                <button type="button" class="media-queue-action" data-action="shuffle" aria-label="Shuffle up next" title="Shuffle up next">
                    <media-icon family="compat" name="shuffle"></media-icon>
                </button>
                <button type="button" class="media-queue-action" data-action="clear" aria-label="Clear up next" title="Clear up next">
                    <media-icon family="compat" name="trash"></media-icon>
                </button>
            </div>
            <ol class="media-queue-list" data-part="list"></ol>`;
        this.#list = this.querySelector('[data-part="list"]');
        this.querySelector('[data-action="shuffle"]')?.addEventListener('click', () => getQueueTarget()?.shuffle());
        this.querySelector('[data-action="clear"]')?.addEventListener('click', () => getQueueTarget()?.clear());
    }

    #render(state: QueueState | null): void {
        const list = this.#list;
        if (!list) return;
        const source = this.querySelector('[data-part="source"]');
        if (source) source.textContent = state?.sourceName ? `from ${state.sourceName}` : '';
        const upcoming = state ? upcomingOf(state) : [];
        for (const button of this.querySelectorAll<HTMLButtonElement>('.media-queue-action')) {
            button.disabled = button.dataset.action === 'shuffle' ? upcoming.length < 2 : upcoming.length === 0;
        }

        list.replaceChildren();
        if (!state) return;
        const history = state.items.slice(0, Math.max(0, state.currentIndex));
        if (history.length) {
            const toggle = document.createElement('li');
            toggle.className = 'media-queue-section';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'media-queue-history-toggle';
            button.setAttribute('aria-expanded', String(this.#showHistory));
            button.textContent = this.#showHistory ? 'Hide played' : `${history.length} played`;
            button.addEventListener('click', () => {
                this.#showHistory = !this.#showHistory;
                this.requestUpdate();
            });
            toggle.appendChild(button);
            list.appendChild(toggle);
            if (this.#showHistory) for (const item of history) list.appendChild(this.#row(item, 'played'));
        }
        const current = state.items[state.currentIndex];
        if (current) list.appendChild(this.#row(current, 'current'));

        const heading = document.createElement('li');
        heading.className = 'media-queue-section';
        heading.textContent = upcoming.length ? 'Up next' : 'Nothing up next. Add media with ＋ or the ⋯ menu in the library.';
        list.appendChild(heading);
        upcoming.forEach((item, index) => list.appendChild(this.#row(item, 'upcoming', index)));
    }

    #row(item: QueueItem, kind: 'played' | 'current' | 'upcoming', index = -1): HTMLLIElement {
        const row = document.createElement('li');
        row.className = 'media-queue-row';
        row.dataset.kind = kind;
        if (kind === 'current') row.setAttribute('aria-current', 'true');

        if (kind === 'upcoming') {
            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'media-queue-handle';
            handle.setAttribute('aria-label', `Move ${item.title} (Alt+Arrow keys)`);
            handle.innerHTML = '<media-icon family="compat" name="grip"></media-icon>';
            handle.addEventListener('pointerdown', (event) => this.#startDrag(event, row, index));
            row.addEventListener('keydown', (event) => {
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                event.preventDefault();
                event.stopPropagation();
                const to = index + (event.key === 'ArrowUp' ? -1 : 1);
                if (to < 0 || to >= this.#upcomingRows().length) return;
                const target = getQueueTarget();
                target?.moveUpcoming(index, to);
                // Rebuild now rather than on the next update, so focus lands on the moved entry.
                this.#render(target?.getState() ?? null);
                this.#upcomingRows()[to]?.querySelector<HTMLElement>('.media-queue-handle')?.focus();
            });
            row.appendChild(handle);
        }

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'media-queue-play';
        play.disabled = kind === 'current';
        const title = document.createElement('span');
        title.className = 'media-queue-item-title';
        title.textContent = item.title;
        const subtitle = document.createElement('span');
        subtitle.className = 'media-queue-item-subtitle';
        subtitle.textContent = kind === 'current' ? `Now playing · ${item.subtitle}` : item.subtitle;
        play.append(title, subtitle);
        play.addEventListener('click', () => { void getQueueTarget()?.jumpTo(item.uid); });
        row.appendChild(play);

        if (kind === 'upcoming') {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'media-queue-action';
            remove.setAttribute('aria-label', `Remove ${item.title} from the queue`);
            remove.innerHTML = '<media-icon family="compat" name="close"></media-icon>';
            remove.addEventListener('click', () => getQueueTarget()?.remove(item.uid));
            row.appendChild(remove);
        }
        return row;
    }

    #upcomingRows(): HTMLElement[] {
        return [...(this.#list?.querySelectorAll<HTMLElement>('.media-queue-row[data-kind="upcoming"]') ?? [])];
    }

    /** Pointer drag on a row's handle: the row follows the pointer through the DOM; the queue changes on release. */
    #startDrag(event: PointerEvent, row: HTMLElement, from: number): void {
        const list = this.#list;
        if (!list || event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);
        this.#dragging = true;
        row.dataset.dragging = '';
        const abort = new AbortController();

        handle.addEventListener('pointermove', (move) => {
            const y = move.clientY;
            const bounds = list.getBoundingClientRect();
            if (y < bounds.top + 24) list.scrollTop -= 8;
            else if (y > bounds.bottom - 24) list.scrollTop += 8;
            const others = this.#upcomingRows().filter((other) => other !== row);
            const before = others.find((other) => {
                const rect = other.getBoundingClientRect();
                return y < rect.top + rect.height / 2;
            });
            if (before) {
                if (row.nextElementSibling !== before) list.insertBefore(row, before);
            } else if (list.lastElementChild !== row) {
                list.appendChild(row);
            }
        }, { signal: abort.signal });

        const finish = (): void => {
            abort.abort();
            delete row.dataset.dragging;
            this.#dragging = false;
            const to = this.#upcomingRows().indexOf(row);
            if (to >= 0 && to !== from) getQueueTarget()?.moveUpcoming(from, to);
            else this.requestUpdate();
        };
        handle.addEventListener('pointerup', finish, { signal: abort.signal });
        handle.addEventListener('pointercancel', finish, { signal: abort.signal });
    }
}

customElements.define(QueueAddButtonElement.tagName, QueueAddButtonElement);
customElements.define(QueuePanelElement.tagName, QueuePanelElement);

declare global {
    interface HTMLElementTagNameMap {
        'media-queue-add-button': QueueAddButtonElement;
        'media-queue-panel': QueuePanelElement;
    }
}
