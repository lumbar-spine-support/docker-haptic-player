/**
 * Copies text to the clipboard.
 *
 * The async Clipboard API only exists in a secure context, which a LAN
 * deployment over plain HTTP is not, so a deprecated `execCommand` path is kept
 * for that case.
 */
export async function copyText(text: string): Promise<boolean> {
    if (window.isSecureContext && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Permission denied or the document lost focus; try the legacy path.
        }
    }
    return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // Kept on-screen but invisible: a display:none element cannot be selected.
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);

    let copied = false;
    try {
        area.select();
        area.setSelectionRange(0, text.length);
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    }
    area.remove();
    return copied;
}
