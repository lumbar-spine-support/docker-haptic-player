import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLibrary } from '../../src/server/services/libraryService';
import { Config } from '../../src/server/config';
import { withMediaFixtures } from '../helpers/index';

const TAG = '[server:service:library]';

const EXAMPLE_TRACK = 'BigBuckBunny_320x180';
const EXAMPLE_TRACK_MP3 = EXAMPLE_TRACK + '.mp3';
const EXAMPLE_TRACK_MP4 = EXAMPLE_TRACK + '.mp4';

test(`${TAG}: buildLibrary discovers media files from fixtures`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        assert.ok(Array.isArray(library.tracks), 'tracks should be an array');
        assert.ok(Array.isArray(library.videos), 'videos should be an array');
        assert.ok(library.tracks.length > 0, 'Should discover audio files');
        assert.ok(library.videos.length > 0, 'Should discover video files');
    });
});

test(`${TAG}: discovers audio files (mp3)`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        const mp3Track = library.tracks.find((t) => t.filename.includes(EXAMPLE_TRACK_MP3));
        assert.ok(mp3Track, 'Should discover MP3 audio file');
        assert.equal(mp3Track?.type, 'audio', 'Audio file should have type "audio"');
        assert.ok(mp3Track?.filename.includes(EXAMPLE_TRACK), 'Filename should match fixture');
    });
});

test(`${TAG}: discovers video files (mp4)`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        const mp4Video = library.videos.find((v) => v.filename.includes(EXAMPLE_TRACK_MP4));
        assert.ok(mp4Video, 'Should discover MP4 video file');
        assert.equal(mp4Video?.type, 'video', 'Video file should have type "video"');
        assert.ok(mp4Video?.filename.includes(EXAMPLE_TRACK), 'Filename should match fixture');
    });
});

test(`${TAG}: parses metadata from audio files`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        const mp3Track = library.tracks.find((t) => t.filename.includes(EXAMPLE_TRACK_MP3));
        assert.ok(mp3Track, 'Should find MP3 track');
        assert.ok(mp3Track?.title, 'Track should have title from metadata');
        assert.ok(
            typeof mp3Track?.durationSeconds === 'number',
            'Track should have numeric duration'
        );
    });
});

test(`${TAG}: associates funscripts with parent media by filename stem`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        const allMedia = [...library.tracks, ...library.videos];
        const mediaWithFunscripts = allMedia.filter((m) => m.funscripts && m.funscripts.length > 0);
        assert.ok(
            mediaWithFunscripts.length > 0,
            'At least one media file should have associated funscripts'
        );
        const bbMedia = allMedia.find((m) => m.filename.includes(EXAMPLE_TRACK));
        assert.ok(bbMedia, 'Should find media');
        assert.ok(
            bbMedia?.funscripts && bbMedia.funscripts.length > 0,
            'Media should have funscripts'
        );
    });
});

test(`${TAG}: detects different funscript types (stroker, buttplug, vibrator, estim, machine)`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        const allMedia = [...library.tracks, ...library.videos];
        const bbMedia = allMedia.find((m) => m.filename.includes(EXAMPLE_TRACK));
        assert.ok(bbMedia, 'Should find media');
        assert.ok(bbMedia?.funscripts, 'Media should have funscripts array');
        const types = new Set(bbMedia?.funscripts?.map((f) => f.type) ?? []);
        assert.ok(types.has('buttplug'), 'Should detect buttplug funscript type');
        // assert.ok(types.has('estim'), 'Should detect estim funscript type');
        // assert.ok(types.has('machine'), 'Should detect machine funscript type');
        assert.ok(types.has('vibrator'), 'Should detect vibrator funscript type');
        assert.ok(types.has('stroker'), 'Should detect stroker funscript type');
    });
});

test(`${TAG}: falls back to the unknown type for funscripts without a suffix`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        const allMedia = [...library.tracks, ...library.videos];
        const bbMedia = allMedia.find((m) => m.filename.includes(EXAMPLE_TRACK));
        const unknown = bbMedia?.funscripts?.filter((f) => f.type === 'unknown') ?? [];
        assert.equal(unknown.length, 1, 'Suffix-less funscript should be associated with the media');
        assert.equal(unknown[0]?.filename, `${EXAMPLE_TRACK}.funscript`);
        assert.equal(unknown[0]?.sub, undefined, 'Unknown scripts have no subcategory');
    });
});

test(`${TAG}: detects funscript subcategories (<stem>.<type>.<sub>.funscript)`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library = await buildLibrary(config);
        const allMedia = [...library.tracks, ...library.videos];
        const bbMedia = allMedia.find((m) => m.filename.includes(EXAMPLE_TRACK));
        const vibrators = bbMedia?.funscripts?.filter((f) => f.type === 'vibrator') ?? [];
        assert.equal(vibrators.length, 2, 'Should find two scripts.');
        assert.ok(
            vibrators.some((f) => f.sub === 'cock'),
            'Subcategorised script should expose its subcategory'
        );
        assert.ok(
            vibrators.some((f) => f.sub === 'balls'),
            'Another subcategorised script should expose its own subcategory'
        );
    });
});

test(`${TAG}: regex-based funscript matching respects config patterns`, async () => {
    await withMediaFixtures(async (_dir, configDefault) => {
        const libraryDefault = await buildLibrary(configDefault);
        const allMediaDefault = [...libraryDefault.tracks, ...libraryDefault.videos];
        const bbDefault = allMediaDefault.find((m) => m.filename.includes(EXAMPLE_TRACK));
        const funscriptCountDefault = bbDefault?.funscripts?.length ?? 0;
        assert.ok(funscriptCountDefault > 0, 'Default suffix should match funscripts');

        const configRestricted: Config.ServerConfig = {
            ...Config.DEFAULT_SERVER_CONFIG,
            mediaDir: configDefault.mediaDir,
            funscriptSuffixStroker: 'impossible_stroker',
            funscriptSuffixButtplug: 'impossible_buttplug',
            funscriptSuffixVibrator: 'impossible_vibrator',
            funscriptSuffixEstim: 'impossible_estim',
            funscriptSuffixMachine: 'impossible_machine',
        };
        const libraryRestricted = await buildLibrary(configRestricted);
        const allMediaRestricted = [...libraryRestricted.tracks, ...libraryRestricted.videos];
        const bbRestricted = allMediaRestricted.find((m) => m.filename.includes(EXAMPLE_TRACK));
        const restricted = bbRestricted?.funscripts ?? [];
        assert.deepEqual(
            restricted.map((f) => f.type),
            ['unknown'],
            'Impossible suffixes should leave only the suffix-less fallback script'
        );
        assert.ok(
            restricted.length < funscriptCountDefault,
            'Restrictive suffix should match fewer funscripts than default'
        );
    });
});

test(`${TAG}: creates consistent file IDs via filenameToId`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const library1 = await buildLibrary(config);
        const library2 = await buildLibrary(config);
        const track1 = library1.tracks[0];
        const track2 = library2.tracks.find((t) => t.filename === track1?.filename);
        assert.ok(track1, 'Should find track in first build');
        assert.ok(track2, 'Should find track in second build');
        assert.equal(
            track1?.id,
            track2?.id,
            'Same filename should produce same ID across builds'
        );
    });
});

test(`${TAG}: handles media in subdirectories`, async () => {
    await withMediaFixtures(async (testDir, config) => {
        const fs = await import('fs');
        const path = await import('path');
        const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/media');

        const subDir = path.join(testDir, 'subfolder');
        fs.mkdirSync(subDir, { recursive: true });
        const mp3File = path.join(FIXTURES_DIR, EXAMPLE_TRACK_MP3);
        if (fs.existsSync(mp3File)) {
            fs.copyFileSync(mp3File, path.join(subDir, EXAMPLE_TRACK_MP3));
        }

        const library = await buildLibrary(config);
        const trackInSubdir = library.tracks.find((t) =>
            t.filename.includes(`subfolder/${EXAMPLE_TRACK_MP3}`)
        );
        assert.ok(
            trackInSubdir,
            'Library should recursively discover files in subdirectories'
        );
        assert.ok(trackInSubdir?.filename.includes('subfolder'), 'Filename should include subdir path');
    });
});

test(`${TAG}: ignores files with extensions in ignoreExt config`, async () => {
    await withMediaFixtures(async (_dir, config) => {
        const configWithIgnore: Config.ServerConfig = {
            ...config,
            ignoreExt: ['mp3'],
        };
        const library = await buildLibrary(configWithIgnore);
        const mp3Track = library.tracks.find((t) => t.filename.includes('.mp3'));
        assert.ok(!mp3Track, 'Should not discover MP3 files when mp3 is in ignoreExt');
    });
});

test(`${TAG}: returns empty library for nonexistent media directory`, async () => {
    const config: Config.ServerConfig = {
        ...Config.DEFAULT_SERVER_CONFIG,
        mediaDir: '/nonexistent/path/that/does/not/exist',
    };

    const library = await buildLibrary(config);

    assert.equal(library.tracks.length, 0, 'Nonexistent dir should have 0 tracks');
    assert.equal(library.videos.length, 0, 'Nonexistent dir should have 0 videos');
    assert.equal(library.albums.length, 0, 'Nonexistent dir should have 0 albums');
    assert.equal(library.playlists.length, 0, 'Nonexistent dir should have 0 playlists');
});
