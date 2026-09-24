import os from 'os';

/** Docker's default bridge range, which is rarely reachable from other devices. */
function rank(address: string): number {
    if (address.startsWith('192.168.')) return 0;
    if (address.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 3;
    return 2;
}

/**
 * Non-loopback IPv4 addresses of this host, best candidate first.
 *
 * Used to suggest a reachable pairing address when the browser is on the server
 * itself and only knows `localhost`. Behind Docker's bridge network this is the
 * container's address rather than the host's, so it stays a suggestion the user
 * can override.
 */
export function lanAddresses(): string[] {
    const found: string[] = [];
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries ?? []) {
            // Node <18 reports family as a number on some platforms.
            const isIPv4 = entry.family === 'IPv4' || (entry.family as unknown as number) === 4;
            if (!isIPv4 || entry.internal || entry.address.startsWith('169.254.')) continue;
            found.push(entry.address);
        }
    }
    return found.sort((a, b) => rank(a) - rank(b));
}
