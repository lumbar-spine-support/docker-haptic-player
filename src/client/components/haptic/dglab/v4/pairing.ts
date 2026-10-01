import QRCode from 'qrcode';
import { log } from '..';

/** Build the deep link that hands a relay URL to the DG-Lab 4 app. */
export function pairingDeepLink(wsUrl: string): string {
    return `https://dungeon-lab.com/s/?v=1&action=socket&url=${encodeURIComponent(wsUrl)}`;
}

/** Build QR-Code for pairing DG-Lab app with a WebSocket URL*/
export function pairingQR(wsUrl: string, callback: (data: string) => void): void {
    const url = `https://www.dungeon-lab.com/app-download.php#DGLAB-SOCKET#${wsUrl}`;
    const promise = QRCode.toDataURL(url);
    const logError = (err: unknown) => log.warn('QR generation failed', err);
    promise.then(callback);
    promise.catch(logError);
}
