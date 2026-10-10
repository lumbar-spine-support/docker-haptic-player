import { UIElement } from '@videojs/html';
import { getQueueTarget, subscribeQueue, upcomingOf, type QueueItem, type QueueSave, type QueueState } from '../features/queue';
import './queue.css';

/** Played entries shown above the current one; older ones stay in the queue but out of the list. */
const MAX_HISTORY = 10;

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Contents of the queue popover: up to ten played entries, the playing one
 * and what is up next. The list opens scrolled so the playing entry is on top.
 * Upcoming entries can be dragged by their handle (or moved with Alt+↑/↓),
 * removed, shuffled and cleared; any entry can be played. The header also holds
 * the repeat button (off → queue → current). Rows slide to their
 * new place, so a change is easy to follow. The whole queue can be saved as a
 * Jellyfin playlist, or back to the playlist it came from.
 *
 * Also hides its popover's trigger while the queue is empty.
 */
class QueuePanelElement extends UIElement {
    static readonly tagName = 'media-queue-panel';

    #unsubscribe: (() => void) | null = null;
    #resize: ResizeObserver | null = null;
    #popoverAbort: AbortController | null = null;
    /** Re-rendering mid-drag would drop the row being dragged. */
    #dragging = false;
    #saving = false;
    /** The playing entry last scrolled to the top; a new one (or reopening) scrolls again. */
    #scrolledTo: number | null = null;
    #list: HTMLOListElement | null = null;

    override connectedCallback(): void {
        super.connectedCallback();
        if (!this.#list) this.#build();
        this.#unsubscribe = subscribeQueue(() => this.requestUpdate());
        const popover = this.closest<HTMLElement & { open?: boolean }>('media-popover');
        this.#popoverAbort = new AbortController();
        popover?.addEventListener('open-change', (event) => {
            if (!(event as CustomEvent<{ open: boolean }>).detail.open) return;
            this.#scrolledTo = null;
            this.requestUpdate();
        }, { signal: this.#popoverAbort.signal });
        // The popover sits in the top layer, so hiding its player (browsing another
        // page) or its trigger (empty queue) would leave it floating; close it instead.
        const trigger = this.#trigger();
        if (trigger) {
            this.#resize = new ResizeObserver(() => {
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
        this.#popoverAbort?.abort();
        this.#popoverAbort = null;
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
                <media-loop-button class="btn btn-sm btn-link media-queue-icon-button media-loop-button">
                    <media-icon family="compat" name="loop" class="media-loop-button-icon"></media-icon>
                </media-loop-button>
                <button type="button" class="btn btn-sm btn-link media-queue-icon-button" data-action="shuffle"
                    aria-label="Shuffle up next" title="Shuffle up next">
                    <i class="bi bi-shuffle" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-sm btn-link media-queue-icon-button" data-action="clear"
                    aria-label="Clear up next" title="Clear up next">
                    <i class="bi bi-trash3" aria-hidden="true"></i>
                </button>
            </div>
            <ol class="media-queue-list list-unstyled mb-0" data-part="list"></ol>
            <div class="media-queue-save" data-part="save">
                <div class="media-queue-save-actions">
                    <button type="button" class="btn btn-sm btn-primary text-truncate" data-action="overwrite">
                        <i class="bi bi-floppy me-1" aria-hidden="true"></i><span data-part="overwrite-label"></span>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="save-new">Save as playlist…</button>
                </div>
                <form class="media-queue-save-form" data-part="save-form" hidden>
                    <input type="text" class="form-control form-control-sm" data-part="name" maxlength="200" required
                        aria-label="Playlist name" placeholder="Playlist name">
                    <button type="submit" class="btn btn-sm btn-primary">Save</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="cancel">Cancel</button>
                </form>
                <div class="media-queue-status small" data-part="status" role="status"></div>
            </div>`;
        this.#list = this.querySelector('[data-part="list"]');
        this.querySelector('[data-action="shuffle"]')?.addEventListener('click', () => getQueueTarget()?.shuffle());
        this.querySelector('[data-action="clear"]')?.addEventListener('click', () => getQueueTarget()?.clear());
        this.#bindSave();
    }

    #bindSave(): void {
        const form = this.querySelector<HTMLFormElement>('[data-part="save-form"]');
        const name = this.querySelector<HTMLInputElement>('[data-part="name"]');
        const saveNew = this.querySelector<HTMLElement>('[data-action="save-new"]');
        if (!form || !name || !saveNew) return;
        const showForm = (open: boolean): void => {
            form.hidden = !open;
            saveNew.hidden = open;
            if (open) {
                const source = getQueueTarget()?.getState().sourceName;
                name.value = source ? `${source} (queue)` : `Queue ${new Date().toLocaleDateString()}`;
                name.select();
                name.focus();
            }
        };
        saveNew.addEventListener('click', () => showForm(true));
        this.querySelector('[data-action="cancel"]')?.addEventListener('click', () => showForm(false));
        this.querySelector('[data-action="overwrite"]')?.addEventListener('click', () => { void this.#save({ mode: 'overwrite' }); });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            void this.#save({ mode: 'new', name: name.value }).then((saved) => { if (saved) showForm(false); });
        });
        // Typing a name must not reach the player's hotkeys (space, k, f, m, …); Escape only leaves the form.
        name.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                showForm(false);
            }
        });
    }

    async #save(request: QueueSave): Promise<boolean> {
        const target = getQueueTarget();
        if (!target || this.#saving) return false;
        this.#saving = true;
        this.#status('Saving…');
        this.requestUpdate();
        try {
            this.#status(await target.save(request));
            return true;
        } catch (error) {
            this.#status(error instanceof Error ? error.message : String(error), true);
            return false;
        } finally {
            this.#saving = false;
            this.requestUpdate();
        }
    }

    #status(text: string, error = false): void {
        const status = this.querySelector<HTMLElement>('[data-part="status"]');
        if (!status) return;
        status.textContent = text;
        status.classList.toggle('text-danger', error);
    }

    #render(state: QueueState | null): void {
        const list = this.#list;
        if (!list) return;
        const source = this.querySelector('[data-part="source"]');
        if (source) source.textContent = state?.sourceName ? `from ${state.sourceName}` : '';
        const upcoming = state ? upcomingOf(state) : [];
        for (const button of this.querySelectorAll<HTMLButtonElement>('.media-queue-header button[data-action]')) {
            button.disabled = button.dataset.action === 'shuffle' ? upcoming.length < 2 : upcoming.length === 0;
        }
        this.#renderSave(state);

        const before = this.#rowTops();
        list.replaceChildren();
        if (!state) return;
        const start = Math.max(0, state.currentIndex - MAX_HISTORY);
        for (const item of state.items.slice(start, Math.max(0, state.currentIndex))) list.appendChild(this.#row(item, 'played'));
        const current = state.items[state.currentIndex];
        if (current) list.appendChild(this.#row(current, 'current'));

        const heading = document.createElement('li');
        heading.className = 'media-queue-section';
        heading.textContent = upcoming.length ? 'Up next' : 'Nothing up next. Add media with the ⋯ menu in the library.';
        list.appendChild(heading);
        upcoming.forEach((item, index) => list.appendChild(this.#row(item, 'upcoming', index)));

        // The list is only as tall as the playing entry and what follows (the popover's
        // max-height still caps it), so the played entries are always above the fold.
        const currentRow = list.querySelector<HTMLElement>('.media-queue-row[data-kind="current"]');
        list.style.maxHeight = currentRow ? `${list.scrollHeight - currentRow.offsetTop}px` : '';
        if (current && currentRow && this.#scrolledTo !== current.uid) {
            this.#scrolledTo = current.uid;
            list.scrollTop = currentRow.offsetTop;
        } else {
            this.#slideFrom(before);
        }
    }

    #renderSave(state: QueueState | null): void {
        const section = this.querySelector<HTMLElement>('[data-part="save"]');
        if (section) section.hidden = !state?.items.length;
        const overwrite = this.querySelector<HTMLButtonElement>('[data-action="overwrite"]');
        if (overwrite) {
            overwrite.hidden = !state?.fromPlaylist;
            overwrite.disabled = this.#saving || !state?.edited;
            overwrite.title = state?.edited ? '' : 'The queue still matches the playlist';
            const label = overwrite.querySelector('[data-part="overwrite-label"]');
            if (label) label.textContent = `Save to “${state?.sourceName ?? ''}”`;
        }
        for (const button of this.querySelectorAll<HTMLButtonElement>('[data-action="save-new"], .media-queue-save-form button[type="submit"]')) {
            button.disabled = this.#saving;
        }
    }

    #row(item: QueueItem, kind: 'played' | 'current' | 'upcoming', index = -1): HTMLLIElement {
        const row = document.createElement('li');
        row.className = 'media-queue-row';
        row.dataset.kind = kind;
        row.dataset.uid = String(item.uid);
        if (kind === 'current') row.setAttribute('aria-current', 'true');

        if (kind === 'upcoming') {
            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'btn btn-sm btn-link media-queue-icon-button media-queue-handle';
            handle.setAttribute('aria-label', `Move ${item.title} (Alt+Arrow keys)`);
            handle.innerHTML = '<i class="bi bi-grip-vertical" aria-hidden="true"></i>';
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
            remove.className = 'btn btn-sm btn-link media-queue-icon-button';
            remove.setAttribute('aria-label', `Remove ${item.title} from the queue`);
            remove.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
            remove.addEventListener('click', () => getQueueTarget()?.remove(item.uid));
            row.appendChild(remove);
        }
        return row;
    }

    #upcomingRows(): HTMLElement[] {
        return [...(this.#list?.querySelectorAll<HTMLElement>('.media-queue-row[data-kind="upcoming"]') ?? [])];
    }

    /** Where each row is on screen now, by entry id (transforms included, so mid-slide positions count). */
    #rowTops(): Map<string, number> {
        const tops = new Map<string, number>();
        for (const row of this.#list?.querySelectorAll<HTMLElement>('.media-queue-row') ?? []) {
            tops.set(row.dataset.uid ?? '', row.getBoundingClientRect().top);
        }
        return tops;
    }

    /** FLIP: rows that moved start where they were and slide to their new place. */
    #slideFrom(before: Map<string, number>): void {
        if (!before.size || reducedMotion()) return;
        const moved: HTMLElement[] = [];
        for (const row of this.#list?.querySelectorAll<HTMLElement>('.media-queue-row') ?? []) {
            const old = before.get(row.dataset.uid ?? '');
            if (old === undefined) continue;
            const delta = old - row.getBoundingClientRect().top;
            if (Math.abs(delta) < 1) continue;
            row.style.transition = 'none';
            row.style.transform = `translateY(${delta}px)`;
            moved.push(row);
        }
        if (!moved.length) return;
        void this.#list?.offsetHeight;
        for (const row of moved) {
            row.style.transition = '';
            row.style.transform = '';
        }
    }

    /**
     * Pointer drag on a row's handle. The row follows the pointer and the rows it
     * passes slide out of its way; nothing leaves the DOM, so pointer capture holds
     * for the whole gesture and a row can travel any distance. The queue changes on release.
     */
    #startDrag(event: PointerEvent, row: HTMLElement, from: number): void {
        const list = this.#list;
        if (!list || event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);
        this.#dragging = true;
        row.dataset.dragging = '';

        const rows = this.#upcomingRows();
        const rects = rows.map((other) => other.getBoundingClientRect());
        const step = rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height;
        const startY = event.clientY;
        const startScroll = list.scrollTop;
        let to = from;
        let pointerY = startY;
        let scrollTimer: ReturnType<typeof setInterval> | null = null;
        const abort = new AbortController();

        const place = (): void => {
            const offset = pointerY - startY + (list.scrollTop - startScroll);
            row.style.transform = `translateY(${offset}px)`;
            const centre = rects[from].top + rects[from].height / 2 + offset;
            to = from;
            while (to < rows.length - 1 && centre > rects[to + 1].top + rects[to + 1].height / 2) to++;
            while (to > 0 && centre < rects[to - 1].top + rects[to - 1].height / 2) to--;
            rows.forEach((other, i) => {
                if (other === row) return;
                const shift = from < to && i > from && i <= to ? -step : to < from && i >= to && i < from ? step : 0;
                other.style.transform = shift ? `translateY(${shift}px)` : '';
            });
        };
        // Near the list's edges it scrolls, so a row can reach entries that are out of view.
        const edgeScroll = (): void => {
            const bounds = list.getBoundingClientRect();
            const speed = pointerY < bounds.top + 32 ? -8 : pointerY > bounds.bottom - 32 ? 8 : 0;
            if (speed && !scrollTimer) {
                scrollTimer = setInterval(() => {
                    list.scrollTop += pointerY < list.getBoundingClientRect().top + 32 ? -8 : 8;
                    place();
                }, 16);
            } else if (!speed && scrollTimer) {
                clearInterval(scrollTimer);
                scrollTimer = null;
            }
        };

        handle.addEventListener('pointermove', (move) => {
            pointerY = move.clientY;
            place();
            edgeScroll();
        }, { signal: abort.signal });

        const finish = (): void => {
            abort.abort();
            if (scrollTimer) clearInterval(scrollTimer);
            delete row.dataset.dragging;
            this.#dragging = false;
            // The rows already show the new order; re-rendering from there slides nothing.
            if (to !== from) getQueueTarget()?.moveUpcoming(from, to);
            else this.#render(getQueueTarget()?.getState() ?? null);
        };
        handle.addEventListener('pointerup', finish, { signal: abort.signal });
        handle.addEventListener('pointercancel', finish, { signal: abort.signal });
    }
}

customElements.define(QueuePanelElement.tagName, QueuePanelElement);

declare global {
    interface HTMLElementTagNameMap {
        'media-queue-panel': QueuePanelElement;
    }
}
