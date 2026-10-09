// Writes ID3v2.4 tags into the audio fixtures so a Jellyfin library built from test/fixtures/media
// has the metadata HAPPY reads: multi-value genres (HAPPY shows Jellyfin genres as tags) and a
// comment (Jellyfin's overview for audiobook libraries, rendered as Markdown by HAPPY).
//
// Jellyfin reads audio tags through ATL, which only splits genres on real multi-value frames
// (several strings in one TCON frame), not on ";" or "/", unless a library enables custom tag
// delimiters. ffmpeg cannot write such frames, hence this small writer. Audio frames are kept
// byte for byte, and so are all frames of the old tag this script does not set (the cover art).
//
//   node scripts/tag-fixture-audio.mjs

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../test/fixtures/media');

const COMMON = { artist: 'Blender Foundation', album: 'Big Buck Bunny', year: '2008' };
const FIXTURES = [
    { file: 'BigBuckBunny_dummy1.mp3', track: 1, title: 'Big Buck Bunny - Dummy 1', genres: ['bunny', 'sfw', 'ambient'],
        comment: '**Dummy track 1.** Its genres become HAPPY tags.' },
    { file: 'BigBuckBunny_dummy2.mp3', track: 2, title: 'Big Buck Bunny - Dummy 2', genres: ['bunny', 'sfw', 'music'],
        comment: '**Dummy track 2.**\n\n- genres: bunny, sfw, music' },
    { file: 'BigBuckBunny_dummy3.mp3', track: 3, title: 'Big Buck Bunny - Dummy 3', genres: ['bunny', 'sfw', 'soundtrack'],
        comment: '**Dummy track 3.** Use an *audiobook* library in Jellyfin to see this comment as the description.' },
];

const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const readSyncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];

function frame(id, body) {
    return Buffer.concat([Buffer.from(id, 'latin1'), syncsafe(body.length), Buffer.from([0, 0]), body]);
}

/** Text frame; several values are NUL-separated, which is how ID3v2.4 stores multi-value fields. */
function text(id, ...values) {
    return frame(id, Buffer.concat([Buffer.from([0x03]), Buffer.from(values.join('\0'), 'utf8')]));
}

function comment(value) {
    return frame('COMM', Buffer.concat([Buffer.from([0x03]), Buffer.from('eng', 'latin1'), Buffer.from([0]), Buffer.from(value, 'utf8')]));
}

/** Frames written by this script; everything else in the old tag (e.g. APIC cover art) is kept. */
const OWNED = new Set(['TIT2', 'TPE1', 'TPE2', 'TALB', 'TRCK', 'TDRC', 'TYER', 'TCON', 'COMM']);

/** Raw frames of a leading ID3v2.3/2.4 tag, re-encoded with v2.4 (syncsafe) sizes. */
function keptFrames(buf) {
    if (buf.subarray(0, 3).toString('latin1') !== 'ID3') return [];
    const version = buf[3];
    const end = 10 + readSyncsafe(buf, 6);
    const kept = [];
    for (let o = 10; o + 10 <= end;) {
        const id = buf.subarray(o, o + 4).toString('latin1');
        if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
        const size = version === 4 ? readSyncsafe(buf, o + 4) : buf.readUInt32BE(o + 4);
        if (!OWNED.has(id)) kept.push(frame(id, buf.subarray(o + 10, o + 10 + size)));
        o += 10 + size;
    }
    return kept;
}

function id3v24(meta, kept) {
    const frames = Buffer.concat([
        text('TIT2', meta.title),
        text('TPE1', meta.artist),
        text('TPE2', meta.artist),
        text('TALB', meta.album),
        text('TRCK', String(meta.track)),
        text('TDRC', meta.year),
        text('TCON', ...meta.genres),
        comment(meta.comment),
        ...kept,
    ]);
    return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([4, 0, 0]), syncsafe(frames.length), frames]);
}

/** The MPEG audio without any ID3v2 (start) or ID3v1 (last 128 bytes) tag. */
function audioOnly(buf) {
    let start = 0;
    while (buf.subarray(start, start + 3).toString('latin1') === 'ID3') {
        const footer = buf[start + 5] & 0x10 ? 10 : 0;
        start += 10 + readSyncsafe(buf, start + 6) + footer;
    }
    let end = buf.length;
    if (end - start >= 128 && buf.subarray(end - 128, end - 125).toString('latin1') === 'TAG') end -= 128;
    return buf.subarray(start, end);
}

for (const fixture of FIXTURES) {
    const file = path.join(DIR, fixture.file);
    const original = fs.readFileSync(file);
    const audio = audioOnly(original);
    if (audio[0] !== 0xff || (audio[1] & 0xe0) !== 0xe0) throw new Error(`${fixture.file}: no MPEG frame after the tags`);
    fs.writeFileSync(file, Buffer.concat([id3v24({ ...COMMON, ...fixture }, keptFrames(original)), audio]));
    console.log(`tagged ${fixture.file}: genres ${fixture.genres.join(', ')}`);
}
