import fs from 'fs';
import path from 'path';
import type { PlaylistEntry, PlaylistInfo, TrackInfo } from '../../shared/types';
import { filenameToId } from '../utils/ids';

function playlistIdFromFilename(filename: string): string {
    return filenameToId(`playlist:${filename}`);
}

function parsePlaylist(content: string): string[] {
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
}

function normalizePlaylistTarget(targetPath: string): string {
    return targetPath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

/** Read each .m3u/.m3u8 file and resolve its lines to library tracks by basename. */
export function buildPlaylists(mediaDir: string, tracks: TrackInfo[], playlistFiles: string[]): PlaylistInfo[] {
    const trackByBasename = new Map<string, TrackInfo[]>();
    const sortedTracks = [...tracks].sort((a, b) => a.filename.localeCompare(b.filename));
    for (const track of sortedTracks) {
        const key = path.basename(track.filename).toLowerCase();
        const bucket = trackByBasename.get(key) ?? [];
        bucket.push(track);
        trackByBasename.set(key, bucket);
    }

    return playlistFiles
        .sort((a, b) => a.localeCompare(b))
        .map((filename) => {
            const fullPath = path.join(mediaDir, filename);
            const content = fs.readFileSync(fullPath, 'utf-8');
            const entries: PlaylistEntry[] = [];
            let durationSeconds = 0;
            let year = '';

            for (const [index, rawTarget] of parsePlaylist(content).entries()) {
                const normalized = normalizePlaylistTarget(rawTarget);
                const basename = path.basename(normalized).toLowerCase();
                const track = trackByBasename.get(basename)?.[0];
                if (!track) continue;

                durationSeconds += track.durationSeconds;
                if (!year && track.year.trim()) {
                    year = track.year;
                }

                entries.push({
                    order: index + 1,
                    path: normalized,
                    trackId: track.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                });
            }

            return {
                id: playlistIdFromFilename(filename),
                filename,
                name: path.basename(filename, path.extname(filename)),
                year,
                durationSeconds,
                entries,
            } satisfies PlaylistInfo;
        });
}
