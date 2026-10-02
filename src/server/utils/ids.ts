/** Derive a stable, URL-safe ID from a filename. */
export function filenameToId(filename: string): string {
    return Buffer.from(filename).toString('base64url');
}

/** Reverse of filenameToId. */
export function idToFilename(id: string): string {
    return Buffer.from(id, 'base64url').toString('utf-8');
}
