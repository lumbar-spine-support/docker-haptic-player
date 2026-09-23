// Persists issued access tokens as plain text so sessions survive container restarts.
// Deleting the file revokes every session; no restart required.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const TAG = '[tokens]';

const TOKEN_BYTES = 32;
const FILE_MODE = 0o600;
const LABEL_MAX_LENGTH = 60;

export interface TokenStore {
    issue(label: string): string;
    verify(token: string | undefined): boolean;
    revoke(token: string): void;
}

/** Reduce arbitrary text to a single whitespace-free field so each record stays one line. */
export function sanitizeLabel(label: string): string {
    const cleaned = label.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '_').trim();
    return cleaned.slice(0, LABEL_MAX_LENGTH) || 'unknown';
}

function parseTokens(contents: string): string[] {
    return contents
        .split('\n')
        .map(line => line.trim().split(' ')[0])
        .filter(token => token.length > 0 && !token.startsWith('#'));
}

function timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export function createTokenStore(filePath: string): TokenStore {
    // Tokens that could not be persisted stay valid until the process exits.
    const memoryTokens = new Set<string>();
    let cached: string[] = [];
    let cachedMtimeMs = -1;

    function readTokens(): string[] {
        let stat: fs.Stats;
        try {
            stat = fs.statSync(filePath);
        } catch {
            cached = [];
            cachedMtimeMs = -1;
            return cached;
        }

        if (stat.mtimeMs === cachedMtimeMs) {
            return cached;
        }

        try {
            cached = parseTokens(fs.readFileSync(filePath, 'utf-8'));
            cachedMtimeMs = stat.mtimeMs;
        } catch (err) {
            console.warn(`${TAG} Could not read token file at ${filePath}:`, err);
            cached = [];
            cachedMtimeMs = -1;
        }

        return cached;
    }

    function writeTokens(lines: string[]): boolean {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, lines.length ? `${lines.join('\n')}\n` : '', { encoding: 'utf-8', mode: FILE_MODE });
            cachedMtimeMs = -1;
            return true;
        } catch (err) {
            console.warn(`${TAG} Could not persist tokens to ${filePath} (mount may be read-only):`, err);
            return false;
        }
    }

    function readLines(): string[] {
        try {
            return fs.readFileSync(filePath, 'utf-8').split('\n').filter(line => line.trim().length > 0);
        } catch {
            return [];
        }
    }

    // Reported at startup rather than at first login, where it would surface as
    // "sessions are silently lost on restart" long after the cause.
    function warnIfNotPersistable(): void {
        const dir = path.dirname(filePath);
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.accessSync(dir, fs.constants.W_OK);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(
                `${TAG} ${dir} is not writable (${reason}).\n` +
                `${TAG} Sessions will be kept in memory only and every restart will require signing in again.\n` +
                `${TAG} Mount a writable /config volume, or point CONFIG_PATH at a writable directory.`,
            );
        }
    }

    warnIfNotPersistable();

    return {
        issue(label: string): string {
            const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
            const record = `${token} ${new Date().toISOString()} ${sanitizeLabel(label)}`;
            if (!writeTokens([...readLines(), record])) {
                memoryTokens.add(token);
            }
            return token;
        },

        verify(token: string | undefined): boolean {
            if (!token) return false;
            for (const known of memoryTokens) {
                if (timingSafeEqual(known, token)) return true;
            }
            return readTokens().some(known => timingSafeEqual(known, token));
        },

        revoke(token: string): void {
            memoryTokens.delete(token);
            const remaining = readLines().filter(line => line.trim().split(' ')[0] !== token);
            writeTokens(remaining);
        },
    };
}
