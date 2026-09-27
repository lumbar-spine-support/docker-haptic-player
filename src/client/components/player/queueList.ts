import type { TrackInfo } from '../../../shared/types';

interface QueueListOptions {
    onMove: (from: number, to: number) => void;
    onSelect: (index: number) => void;
    onRemove: (index: number) => void;
}

interface DragState {
    row: HTMLTableRowElement;
    pointerId: number;
    from: number;
    startY: number;
    lastY: number;
    scrollFrame: number;
}

const SCROLL_EDGE = 40;
const SCROLL_STEP = 8;

/** Upcoming-tracks table, next track at the bottom, reordered by dragging the grip cell. */
export class QueueList {
    private drag: DragState | null = null;
    private count = 0;

    constructor(
        private readonly body: HTMLTableSectionElement,
        private readonly scroller: HTMLElement,
        private readonly options: QueueListOptions,
    ) {
        body.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        body.addEventListener('pointermove', (event) => this.onPointerMove(event));
        body.addEventListener('pointerup', (event) => this.onPointerEnd(event, true));
        body.addEventListener('pointercancel', (event) => this.onPointerEnd(event, false));
        body.addEventListener('click', (event) => this.onClick(event));
    }

    render(tracks: TrackInfo[]): void {
        this.endDrag();
        this.count = tracks.length;
        this.body.replaceChildren(...tracks.map((track) => this.buildRow(track)).reverse());
        this.scroller.scrollTop = this.scroller.scrollHeight;
    }

    /** Rows are shown reversed; converts a row position to an `upcoming` index. */
    private toIndex(row: number): number {
        return this.count - 1 - row;
    }

    private buildRow(track: TrackInfo): HTMLTableRowElement {
        const row = document.createElement('tr');
        const grip = row.insertCell();
        grip.className = 'player-queue-grip text-muted';
        grip.setAttribute('aria-label', 'Drag to reorder');
        const icon = document.createElement('i');
        icon.className = 'bi bi-grip-horizontal';
        icon.setAttribute('aria-hidden', 'true');
        grip.append(icon);

        const info = row.insertCell();
        info.className = 'text-truncate';
        const title = document.createElement('div');
        title.className = 'text-truncate';
        title.textContent = track.title;
        const artist = document.createElement('div');
        artist.className = 'text-muted small text-truncate';
        artist.textContent = track.artist || track.filename;
        info.append(title, artist);

        const actions = row.insertCell();
        actions.className = 'player-queue-remove-cell text-end';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-dark btn-sm player-queue-remove';
        remove.setAttribute('aria-label', `Remove ${track.title} from queue`);
        const trash = document.createElement('i');
        trash.className = 'bi bi-trash3-fill';
        trash.setAttribute('aria-hidden', 'true');
        remove.append(trash);
        actions.append(remove);
        return row;
    }

    private rows(): HTMLTableRowElement[] {
        return Array.from(this.body.rows);
    }

    private onClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (target.closest('.player-queue-grip')) return;
        const row = target.closest('tr');
        if (!row || row.parentElement !== this.body) return;
        if (target.closest('.player-queue-remove')) {
            this.options.onRemove(this.toIndex(row.sectionRowIndex));
            return;
        }
        this.options.onSelect(this.toIndex(row.sectionRowIndex));
    }

    private onPointerDown(event: PointerEvent): void {
        if (this.drag || event.button !== 0) return;
        const grip = (event.target as HTMLElement).closest('.player-queue-grip');
        const row = grip?.closest('tr');
        if (!row) return;
        event.preventDefault();
        row.setPointerCapture(event.pointerId);
        row.classList.add('is-dragging');
        this.drag = {
            row,
            pointerId: event.pointerId,
            from: row.sectionRowIndex,
            startY: event.clientY,
            lastY: event.clientY,
            scrollFrame: 0,
        };
        this.autoScroll();
    }

    private onPointerMove(event: PointerEvent): void {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.lastY = event.clientY;
        this.reposition();
    }

    /** Swaps the dragged row past any neighbour whose midpoint it crossed. */
    private reposition(): void {
        const drag = this.drag;
        if (!drag) return;
        const { row } = drag;
        row.style.transform = '';
        let moved = true;
        while (moved) {
            moved = false;
            const prev = row.previousElementSibling as HTMLElement | null;
            const next = row.nextElementSibling as HTMLElement | null;
            const offset = drag.lastY - drag.startY;
            const rowRect = row.getBoundingClientRect();
            const centre = rowRect.top + rowRect.height / 2 + offset;
            if (prev) {
                const rect = prev.getBoundingClientRect();
                if (centre < rect.top + rect.height / 2) {
                    prev.before(row);
                    drag.startY -= rect.height;
                    moved = true;
                    continue;
                }
            }
            if (next) {
                const rect = next.getBoundingClientRect();
                if (centre > rect.top + rect.height / 2) {
                    next.after(row);
                    drag.startY += rect.height;
                    moved = true;
                }
            }
        }
        // Keep the row inside the table, or its transform grows the scroll area forever.
        const bodyRect = this.body.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const offset = Math.min(
            Math.max(drag.lastY - drag.startY, bodyRect.top - rowRect.top),
            bodyRect.bottom - rowRect.bottom,
        );
        row.style.transform = `translateY(${offset}px)`;
    }

    private autoScroll(): void {
        const drag = this.drag;
        if (!drag) return;
        const rect = this.scroller.getBoundingClientRect();
        let delta = 0;
        if (drag.lastY < rect.top + SCROLL_EDGE) delta = -SCROLL_STEP;
        else if (drag.lastY > rect.bottom - SCROLL_EDGE) delta = SCROLL_STEP;
        if (delta) {
            const before = this.scroller.scrollTop;
            this.scroller.scrollTop += delta;
            // Scrolling shifts the rows under a still pointer; keep the row with it.
            drag.startY -= this.scroller.scrollTop - before;
            this.reposition();
        }
        drag.scrollFrame = requestAnimationFrame(() => this.autoScroll());
    }

    private onPointerEnd(event: PointerEvent, commit: boolean): void {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        const to = drag.row.sectionRowIndex;
        this.endDrag();
        if (!commit) {
            this.restoreOrder(drag);
            return;
        }
        if (to !== drag.from) this.options.onMove(this.toIndex(drag.from), this.toIndex(to));
    }

    private restoreOrder(drag: DragState): void {
        const anchor = this.rows().filter((r) => r !== drag.row)[drag.from];
        if (anchor) anchor.before(drag.row);
        else this.body.append(drag.row);
    }

    private endDrag(): void {
        const drag = this.drag;
        if (!drag) return;
        this.drag = null;
        cancelAnimationFrame(drag.scrollFrame);
        drag.row.classList.remove('is-dragging');
        drag.row.style.transform = '';
        if (drag.row.hasPointerCapture(drag.pointerId)) drag.row.releasePointerCapture(drag.pointerId);
    }
}
