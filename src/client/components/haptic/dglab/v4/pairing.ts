/** Build the deep link that hands a relay URL to the DG-Lab 4 app. */
export function pairingDeepLink(wsUrl: string): string {
    return `https://dungeon-lab.cn/s/?v=1&action=socket&url=${encodeURIComponent(wsUrl)}`;
}

/** Build the payload the DG-Lab 4 app's QR scanner expects. */
export function pairingQrPayload(wsUrl: string): string {
    return `https://www.dungeon-lab.com/app-download.php#DGLAB-SOCKET#${wsUrl}`;
}
