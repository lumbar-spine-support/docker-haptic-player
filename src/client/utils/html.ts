export function qs<T extends HTMLElement>(selector: string): T | null {
    return document.querySelector(selector);
}

export function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
