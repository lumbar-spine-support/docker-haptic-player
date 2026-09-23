// Minimal Cookie header reader. Express 5 ships res.cookie(), so only the read side is missing.

export function parseCookies(header: string | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (!header) return result;

    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 1) continue;

        const name = part.slice(0, separator).trim();
        const raw = part.slice(separator + 1).trim().replace(/^"|"$/g, '');
        if (!name || name in result) continue;

        try {
            result[name] = decodeURIComponent(raw);
        } catch {
            result[name] = raw;
        }
    }

    return result;
}
