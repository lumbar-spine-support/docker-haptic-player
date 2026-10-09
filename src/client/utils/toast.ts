const VISIBLE_MS = 2500;

let element: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Short, self-dismissing confirmation at the bottom of the page, also read out by screen readers. */
export function showToast(message: string): void {
    if (!element) {
        element = document.createElement('div');
        element.className = 'happy-toast';
        element.setAttribute('role', 'status');
        element.setAttribute('aria-live', 'polite');
        document.body.appendChild(element);
    }
    element.textContent = message;
    element.classList.add('show');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => element?.classList.remove('show'), VISIBLE_MS);
}
