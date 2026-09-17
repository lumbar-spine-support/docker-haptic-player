// Shared helpers for serving media files from routes. Throws HttpError instead of responding.

import fs from 'fs';
import { HttpError } from './errorHandler';
import { idToFilename } from '../services/libraryService';
import { resolveMediaPath } from './paths';

// Decode a base64url track ID to a filename; throws 400 if invalid.
export function decodeTrackId(id: string): string {
    try {
        return idToFilename(id);
    } catch {
        throw new HttpError(400, 'Invalid track id');
    }
}

// Resolve a relative path to a media file; throws 404 if not found or outside media root.
export function requireMediaFile(
    mediaDir: string,
    relativePath: string,
    notFoundMessage = 'File not found',
): string {
    const filePath = resolveMediaPath(mediaDir, relativePath);
    if (!filePath || !fs.existsSync(filePath)) {
        throw new HttpError(404, notFoundMessage);
    }
    return filePath;
}
