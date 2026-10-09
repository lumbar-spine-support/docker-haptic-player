import test from 'node:test';
import assert from 'node:assert/strict';
import type { JellyfinConnection } from '../../src/client/jellyfin/connection';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../src/shared/funscriptNames';

const TAG = '[client:favorites]';

// Minimal DOM stand-ins: just what favorites.ts touches on buttons, icons and the document.
class FakeClassList {
    private readonly names = new Set<string>();
    constructor(initial = '') { for (const n of initial.split(/\s+/).filter(Boolean)) this.names.add(n); }
    add(name: string): void { this.names.add(name); }
    remove(name: string): void { this.names.delete(name); }
    contains(name: string): boolean { return this.names.has(name); }
    toggle(name: string, force?: boolean): boolean {
        const on = force ?? !this.names.has(name);
        if (on) this.names.add(name); else this.names.delete(name);
        return on;
    }
}

class FakeElement {
    readonly attributes = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    readonly children: FakeElement[] = [];
    readonly listeners = new Map<string, ((event: unknown) => void)[]>();
    classList = new FakeClassList();
    title = '';
    type = '';
    constructor(readonly tagName: string) { }
    set className(value: string) { this.classList = new FakeClassList(value); }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
    querySelector(selector: string): FakeElement | null {
        if (selector === 'i') return this.children.find((c) => c.tagName === 'i') ?? null;
        if (selector === '[data-favorite-label]') return this.children.find((c) => 'favoriteLabel' in c.dataset) ?? null;
        return null;
    }
    addEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    /** Dispatches a click and reports whether default/propagation were stopped. */
    click(): { prevented: boolean; stopped: boolean } {
        const result = { prevented: false, stopped: false };
        const event = { preventDefault: () => { result.prevented = true; }, stopPropagation: () => { result.stopped = true; } };
        for (const listener of this.listeners.get('click') ?? []) listener(event);
        return result;
    }
}

let favorites: typeof import('../../src/client/components/library/favorites');
let feature: typeof import('../../@/components/videojs/features/favorite');
let api: typeof import('../../src/client/api');

/** Buttons "in the document", found by `querySelectorAll('button[data-favorite-id]')`. */
let attached: FakeElement[] = [];
/** How the fake Jellyfin answers favorite requests. */
let respond: (method: string) => Promise<Response> = async () => new Response('{}');
const requests: { path: string; method?: string }[] = [];

const originalDocument = (globalThis as any).document;

function heartButton(): FakeElement {
    const button = new FakeElement('button');
    button.appendChild(new FakeElement('i'));
    return button;
}

function asButton(el: FakeElement): HTMLButtonElement {
    return el as unknown as HTMLButtonElement;
}

function icon(el: FakeElement): FakeElement {
    return el.querySelector('i')!;
}

/** Lets pending promise callbacks (the fake request and the toggle's finally) run. */
function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

test.before(async () => {
    (globalThis as any).document = {
        createElement: (tag: string) => new FakeElement(tag),
        querySelectorAll: (selector: string) => {
            assert.equal(selector, 'button[data-favorite-id]');
            return attached.filter((b) => b.dataset.favoriteId !== undefined);
        },
    };
    favorites = await import('../../src/client/components/library/favorites');
    feature = await import('../../@/components/videojs/features/favorite');
    api = await import('../../src/client/api');
    const connection = {
        userId: 'u',
        async request(path: string, init?: RequestInit): Promise<Response> {
            requests.push({ path, method: init?.method });
            return respond(init?.method ?? 'GET');
        },
    } as unknown as JellyfinConnection;
    api.useJellyfin(connection, { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded', 'funscript'] });
});

test.after(() => {
    (globalThis as any).document = originalDocument;
});

test.beforeEach(() => {
    attached = [];
    requests.length = 0;
    respond = async (method) => new Response(JSON.stringify({ IsFavorite: method === 'POST' }));
});

test(`${TAG} renderFavoriteButton shows the filled heart, pressed state and label`, () => {
    const button = heartButton();
    favorites.renderFavoriteButton(asButton(button), true);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.ok(button.classList.contains('is-favorite'));
    assert.equal(button.title, 'Remove from favorites');
    assert.equal(button.getAttribute('aria-label'), 'Remove from favorites');
    assert.ok(icon(button).classList.contains('bi-heart-fill'));
    assert.ok(!icon(button).classList.contains('bi-heart'));

    favorites.renderFavoriteButton(asButton(button), false);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.ok(!button.classList.contains('is-favorite'));
    assert.equal(button.title, 'Add to favorites');
    assert.equal(button.getAttribute('aria-label'), 'Add to favorites');
    assert.ok(icon(button).classList.contains('bi-heart'));
    assert.ok(!icon(button).classList.contains('bi-heart-fill'));
});

test(`${TAG} renderFavoriteButton keeps a visible label and tolerates no icon`, () => {
    const button = new FakeElement('button');
    const label = new FakeElement('span');
    label.dataset.favoriteLabel = '';
    button.appendChild(label);
    favorites.renderFavoriteButton(asButton(button), true);
    assert.equal(button.getAttribute('aria-label'), null, 'a visible label names the button');
    assert.equal(button.title, 'Remove from favorites');
});

test(`${TAG} createFavoriteButton builds a bound heart button`, () => {
    const button = favorites.createFavoriteButton({ id: 'a', isFavorite: true }) as unknown as FakeElement;
    assert.equal(button.type, 'button');
    assert.ok(button.classList.contains('favorite-btn'));
    assert.equal(button.dataset.favoriteId, 'a');
    assert.equal(button.dataset.favoriteBound, 'true');
    assert.ok(!button.classList.contains('d-none'));
    assert.equal(icon(button).getAttribute('aria-hidden'), 'true');
    assert.ok(icon(button).classList.contains('bi-heart-fill'));
});

test(`${TAG} bindFavoriteButton with null hides and detaches the button`, async () => {
    const button = heartButton();
    favorites.bindFavoriteButton(asButton(button), { id: 'b', isFavorite: false });
    favorites.bindFavoriteButton(asButton(button), null);
    assert.ok(button.classList.contains('d-none'));
    assert.equal(button.dataset.favoriteId, undefined);
    const { prevented, stopped } = button.click();
    assert.ok(prevented && stopped, 'the click never reaches the card');
    await settle();
    assert.equal(requests.length, 0, 'a detached button toggles nothing');
});

test(`${TAG} rebinding wires the click handler only once`, async () => {
    const button = heartButton();
    favorites.bindFavoriteButton(asButton(button), { id: 'c1', isFavorite: false });
    const second = { id: 'c2', isFavorite: false };
    favorites.bindFavoriteButton(asButton(button), second);
    assert.equal(button.listeners.get('click')?.length, 1);
    attached = [button];
    button.click();
    await settle();
    assert.deepEqual(requests.map((r) => [r.path, r.method]), [['/UserFavoriteItems/c2?userId=u', 'POST']]);
    assert.equal(second.isFavorite, true);
});

test(`${TAG} clicking toggles in Jellyfin and updates every button of the item`, async () => {
    const item = { id: 'd', isFavorite: false };
    const card = heartButton();
    const row = heartButton();
    const other = heartButton();
    favorites.bindFavoriteButton(asButton(card), item);
    favorites.bindFavoriteButton(asButton(row), { ...item });
    favorites.bindFavoriteButton(asButton(other), { id: 'other', isFavorite: false });
    attached = [card, row, other];
    let notified = 0;
    const unsubscribe = feature.subscribeFavorite(() => { notified++; });
    try {
        card.click();
        // Optimistic: shown at once, before Jellyfin answers.
        assert.equal(item.isFavorite, true);
        assert.equal(row.getAttribute('aria-pressed'), 'true');
        await settle();
        assert.equal(item.isFavorite, true);
        assert.equal(card.getAttribute('aria-pressed'), 'true');
        assert.equal(row.getAttribute('aria-pressed'), 'true');
        assert.equal(other.getAttribute('aria-pressed'), 'false');
        assert.equal(notified, 2, 'player buttons hear about the optimistic and the final state');

        card.click();
        await settle();
        assert.equal(item.isFavorite, false);
        assert.equal(row.getAttribute('aria-pressed'), 'false');
        assert.deepEqual(requests.map((r) => r.method), ['POST', 'DELETE']);
    } finally {
        unsubscribe();
    }
});

test(`${TAG} toggleFavorite keeps the state Jellyfin stored`, async () => {
    respond = async () => new Response(JSON.stringify({ IsFavorite: false }));
    const item = { id: 'e', isFavorite: false };
    await favorites.toggleFavorite(item);
    assert.equal(item.isFavorite, false);
});

test(`${TAG} toggleFavorite reverts when Jellyfin refuses`, async (t) => {
    const errors = t.mock.method(console, 'error', () => { });
    respond = async () => new Response('', { status: 500 });
    const item = { id: 'f', isFavorite: true };
    const button = heartButton();
    favorites.bindFavoriteButton(asButton(button), item);
    attached = [button];
    await favorites.toggleFavorite(item);
    assert.equal(item.isFavorite, true);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(errors.mock.callCount(), 1);
});

test(`${TAG} clicks while a request is in flight are ignored`, async () => {
    let release: () => void = () => { };
    respond = (method) => new Promise((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ IsFavorite: method === 'POST' })));
    });
    const item = { id: 'g', isFavorite: false };
    const first = favorites.toggleFavorite(item);
    await favorites.toggleFavorite(item);
    assert.equal(item.isFavorite, true, 'the second toggle did not flip it back');
    release();
    await first;
    assert.equal(requests.length, 1);
    assert.equal(item.isFavorite, true);
    // Once settled, the item can be toggled again.
    respond = async (method) => new Response(JSON.stringify({ IsFavorite: method === 'POST' }));
    await favorites.toggleFavorite(item);
    assert.equal(item.isFavorite, false);
    assert.equal(requests.length, 2);
});
