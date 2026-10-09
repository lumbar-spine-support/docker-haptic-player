import test from 'node:test';
import assert from 'node:assert/strict';
import type { JellyfinItemDto } from '../../src/client/jellyfin/dto';
import { buildLibrary, toTrack, trickplayOf, type MapOptions } from '../../src/client/jellyfin/mapper';
import { setFavorite, type JellyfinApi } from '../../src/client/jellyfin/library';
import { imageUrl, streamUrl, trickplayVtt } from '../../src/client/jellyfin/urls';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../src/shared/funscriptNames';

const TAG = '[client:jellyfin]';

// Synthetic Jellyfin responses, shaped like Jellyfin 12.1 with Fields=Path,Tags,Genres,Overview,Chapters,Trickplay.
const SERVER = 'https://jellyfin.example.com';
const ENDPOINT = { serverUrl: SERVER, token: 'secret token' };
const OPTIONS: MapOptions = { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded', 'funscript'] };

const AUDIO: JellyfinItemDto = {
    Id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    Name: 'First Track',
    Type: 'AudioBook',
    MediaType: 'Audio',
    Path: '/media/audio/Artist - First Track.mp3',
    Overview: '**Bold** description',
    Tags: ['Relax'],
    Genres: ['relax', 'Ambient'],
    Album: 'Collection',
    AlbumArtist: 'Artist',
    ProductionYear: 2024,
    IndexNumber: 2,
    RunTimeTicks: 1234 * 10_000_000,
    ImageTags: { Primary: 'tag-1' },
    Chapters: [
        { StartPositionTicks: 600 * 10_000_000, Name: 'Second' },
        { StartPositionTicks: 0, Name: '' },
    ],
};

const SECOND_AUDIO: JellyfinItemDto = {
    Id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
    Name: 'Opening',
    Type: 'Audio',
    MediaType: 'Audio',
    Path: '/media/audio/opening.m4a',
    Album: 'Collection',
    Artists: ['Artist'],
    AlbumArtist: 'Artist',
    IndexNumber: 1,
    RunTimeTicks: 60 * 10_000_000,
};

const VIDEO: JellyfinItemDto = {
    Id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1',
    Name: 'Clip',
    Type: 'Movie',
    MediaType: 'Video',
    Path: '/media/video/Clip_180_LR.mp4',
    RunTimeTicks: 95 * 10_000_000,
    Trickplay: {
        'cccccccccccccccccccccccccccccccc': {
            '160': { Width: 160, Height: 90, TileWidth: 10, TileHeight: 10, ThumbnailCount: 10, Interval: 10_000 },
            '320': { Width: 320, Height: 180, TileWidth: 2, TileHeight: 2, ThumbnailCount: 10, Interval: 10_000 },
        },
    },
};

const FOLDER: JellyfinItemDto = { Id: 'dddddddddddddddddddddddddddddddd', Name: 'Folder', Type: 'Folder' };

const FUNSCRIPTS = {
    [VIDEO.Id]: [
        { Key: '00000000000000b2', FileName: 'Clip_180_LR.vibrator.funscript' },
        { Key: '00000000000000b1', FileName: 'Clip_180_LR.estim.Left.funscript' },
    ],
};

test(`${TAG} maps an audio item to a track`, () => {
    const track = toTrack(AUDIO, undefined, OPTIONS);
    assert.ok(track);
    assert.equal(track.type, 'audio');
    assert.equal(track.filename, 'Artist - First Track.mp3');
    assert.equal(track.title, 'First Track');
    assert.equal(track.artist, 'Artist');
    assert.equal(track.year, '2024');
    assert.equal(track.trackNumber, 2);
    assert.equal(track.durationSeconds, 1234);
    assert.equal(track.description, '**Bold** description');
    assert.equal(track.hasArtwork, true);
    assert.equal(track.artworkTag, 'tag-1');
    assert.deepEqual(track.funscripts, []);
});

test(`${TAG} tags merge Jellyfin tags and genres case-insensitively`, () => {
    assert.deepEqual(toTrack(AUDIO, undefined, OPTIONS)?.tags, ['Relax', 'Ambient']);
});

test(`${TAG} embedded chapters are sorted, named and closed at the duration`, () => {
    const track = toTrack(AUDIO, undefined, OPTIONS);
    assert.equal(track?.chaptersSource, 'embedded');
    assert.deepEqual(track?.chapters, [
        { name: 'Chapter 1', start: 0, end: 600 },
        { name: 'Second', start: 600, end: 1234 },
    ]);
    assert.equal(toTrack(AUDIO, undefined, { ...OPTIONS, chapterSourcePriority: ['funscript'] })?.chapters, undefined);
});

test(`${TAG} funscripts from the plugin listing get type and subcategory`, () => {
    const track = toTrack(VIDEO, FUNSCRIPTS[VIDEO.Id], OPTIONS);
    assert.deepEqual(track?.funscripts, [
        { key: '00000000000000b1', filename: 'Clip_180_LR.estim.Left.funscript', type: 'estim', sub: 'Left' },
        { key: '00000000000000b2', filename: 'Clip_180_LR.vibrator.funscript', type: 'vibrator' },
    ]);
});

test(`${TAG} picks the trickplay resolution closest to 320 px`, () => {
    const track = toTrack(VIDEO, undefined, OPTIONS);
    assert.deepEqual(track?.trickplay, {
        mediaSourceId: 'cccccccccccccccccccccccccccccccc',
        resolution: 320,
        width: 320,
        height: 180,
        columns: 2,
        rows: 2,
        count: 10,
        intervalSeconds: 10,
    });
    assert.equal(track?.hasArtwork, false);
    assert.equal(toTrack(AUDIO, undefined, OPTIONS)?.trickplay, undefined);
});

test(`${TAG} skips items that are neither audio nor video`, () => {
    assert.equal(toTrack(FOLDER, undefined, OPTIONS), null);
});

test(`${TAG} builds the library with client-side albums and resolved playlists`, () => {
    const library = buildLibrary([AUDIO, SECOND_AUDIO, VIDEO, FOLDER], FUNSCRIPTS, [
        { item: { Id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1', Name: 'Mix', Type: 'Playlist' }, entries: [VIDEO, FOLDER, AUDIO] },
        { item: { Id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2', Name: 'Empty', Type: 'Playlist' }, entries: [FOLDER] },
    ], OPTIONS);

    assert.deepEqual(library.tracks.map((t) => t.id), [AUDIO.Id, SECOND_AUDIO.Id]);
    assert.deepEqual(library.videos.map((t) => t.id), [VIDEO.Id]);

    assert.equal(library.albums.length, 1);
    const [album] = library.albums;
    assert.match(album.id, /^album-[0-9a-z]+$/);
    assert.deepEqual(album.trackIds, [SECOND_AUDIO.Id, AUDIO.Id], 'ordered by track number');
    assert.equal(album.coverTrackId, AUDIO.Id, 'the first track with artwork');
    assert.equal(album.durationSeconds, 1294);

    assert.equal(library.playlists.length, 1, 'playlists without playable entries are dropped');
    assert.deepEqual(library.playlists[0].entries.map((e) => [e.order, e.trackId]), [[0, VIDEO.Id], [1, AUDIO.Id]]);
    assert.equal(library.playlists[0].durationSeconds, 95 + 1234);
});

test(`${TAG} favorites come from the user data of tracks and playlists`, () => {
    assert.equal(toTrack(AUDIO, undefined, OPTIONS)?.isFavorite, false, 'no UserData means not a favorite');
    assert.equal(toTrack({ ...AUDIO, UserData: { IsFavorite: true } }, undefined, OPTIONS)?.isFavorite, true);
    assert.equal(toTrack({ ...AUDIO, UserData: { IsFavorite: false } }, undefined, OPTIONS)?.isFavorite, false);

    const library = buildLibrary([AUDIO], {}, [
        { item: { Id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1', Name: 'Liked', Type: 'Playlist', UserData: { IsFavorite: true } }, entries: [AUDIO] },
        { item: { Id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2', Name: 'Other', Type: 'Playlist' }, entries: [AUDIO] },
    ], OPTIONS);
    assert.deepEqual(library.playlists.map((p) => p.isFavorite), [true, false]);
});

function fakeApi(response: Response): JellyfinApi & { calls: { path: string; method?: string }[] } {
    const calls: { path: string; method?: string }[] = [];
    return {
        userId: 'user 1',
        calls,
        request: async (path, init) => {
            calls.push({ path, method: init?.method });
            return response;
        },
    };
}

test(`${TAG} setFavorite adds and removes through UserFavoriteItems`, async () => {
    const add = fakeApi(new Response(JSON.stringify({ IsFavorite: true }), { status: 200 }));
    assert.equal(await setFavorite(add, AUDIO.Id, true), true);
    assert.deepEqual(add.calls, [{ path: `/UserFavoriteItems/${AUDIO.Id}?userId=user%201`, method: 'POST' }]);

    const remove = fakeApi(new Response(JSON.stringify({ IsFavorite: false }), { status: 200 }));
    assert.equal(await setFavorite(remove, AUDIO.Id, false), false);
    assert.equal(remove.calls[0].method, 'DELETE');
});

test(`${TAG} setFavorite trusts the request when Jellyfin returns no body, and throws on errors`, async () => {
    assert.equal(await setFavorite(fakeApi(new Response(null, { status: 204 })), AUDIO.Id, true), true);
    await assert.rejects(setFavorite(fakeApi(new Response('', { status: 403 })), AUDIO.Id, true), /HTTP 403/);
});

test(`${TAG} stream URLs request the original file with the token in the query`, () => {
    assert.equal(streamUrl(ENDPOINT, { id: VIDEO.Id, type: 'video' }),
        `${SERVER}/Videos/${VIDEO.Id}/stream?static=true&ApiKey=secret%20token`);
    assert.equal(streamUrl(ENDPOINT, { id: AUDIO.Id, type: 'audio' }),
        `${SERVER}/Audio/${AUDIO.Id}/stream?static=true&ApiKey=secret%20token`);
});

test(`${TAG} image URLs carry the tag and no token`, () => {
    const url = new URL(imageUrl(SERVER, AUDIO.Id, 'tag-1'));
    assert.equal(url.pathname, `/Items/${AUDIO.Id}/Images/Primary`);
    assert.equal(url.searchParams.get('tag'), 'tag-1');
    assert.equal(url.searchParams.has('ApiKey'), false);
});

test(`${TAG} trickplay VTT walks the sheets with #xywh fragments`, () => {
    const track = toTrack(VIDEO, undefined, OPTIONS);
    assert.ok(track);
    const vtt = trickplayVtt(ENDPOINT, track);
    assert.ok(vtt);
    const cues = vtt.trimEnd().split('\n\n').slice(1).map((cue) => cue.split('\n'));
    assert.equal(cues.length, 10);
    const sheet = (n: number) => `${SERVER}/Videos/${VIDEO.Id}/Trickplay/320/${n}.jpg?mediaSourceId=cccccccccccccccccccccccccccccccc&ApiKey=secret+token`;
    assert.deepEqual(cues[0], ['00:00:00.000 --> 00:00:10.000', `${sheet(0)}#xywh=0,0,320,180`]);
    assert.deepEqual(cues[3], ['00:00:30.000 --> 00:00:40.000', `${sheet(0)}#xywh=320,180,320,180`]);
    assert.deepEqual(cues[4], ['00:00:40.000 --> 00:00:50.000', `${sheet(1)}#xywh=0,0,320,180`]);
    assert.deepEqual(cues[9], ['00:01:30.000 --> 00:01:35.000', `${sheet(2)}#xywh=320,0,320,180`]);
    assert.equal(trickplayVtt(ENDPOINT, { ...track, trickplay: undefined }), null);
});

test(`${TAG} storyboard cues stop at the last thumbnail Jellyfin generated`, () => {
    const track = toTrack({ ...VIDEO, RunTimeTicks: 99 * 10_000_000 }, undefined, OPTIONS);
    assert.ok(track);
    // 99 s at 10 s per thumbnail would be 10 cues, but only 10 thumbnails exist (0-9), so the
    // last cue must still be index 9 and nothing points past the end of the last sheet.
    const cues = trickplayVtt(ENDPOINT, { ...track, durationSeconds: 120 })!.trimEnd().split('\n\n').slice(1);
    assert.equal(cues.length, 10);
});

test(`${TAG} VR180 storyboards show one eye of each tile`, () => {
    const track = toTrack(VIDEO, undefined, OPTIONS);
    assert.ok(track);
    const fragments = (vr: Parameters<typeof trickplayVtt>[2]) => trickplayVtt(ENDPOINT, track, vr)!
        .trimEnd().split('\n\n').slice(1).map((cue) => cue.split('#')[1]);
    assert.deepEqual(fragments({ fov: 180, layout: 'sbs' }).slice(0, 2), ['xywh=0,0,160,180', 'xywh=320,0,160,180']);
    assert.deepEqual(fragments({ fov: 180, layout: 'tb' }).slice(0, 2), ['xywh=0,0,320,90', 'xywh=320,0,320,90']);
    assert.deepEqual(fragments(null).slice(0, 2), ['xywh=0,0,320,180', 'xywh=320,0,320,180']);
});

test(`${TAG} sparse items fall back to the file stem, the id and empty metadata`, () => {
    const track = toTrack({ Id: 'ffffffffffffffffffffffffffffff01', Type: 'Audio', MediaType: 'Audio', Path: 'C:\\media\\Some Song.flac', Name: '  ' }, undefined, OPTIONS);
    assert.ok(track);
    assert.equal(track.filename, 'Some Song.flac', 'Windows paths are split at backslashes');
    assert.equal(track.title, 'Some Song');
    assert.equal(track.description, '');
    assert.equal(track.artist, '');
    assert.equal(track.album, '');
    assert.equal(track.year, '');
    assert.equal(track.trackNumber, null);
    assert.equal(track.durationSeconds, 0);
    assert.equal(track.hasArtwork, false);
    assert.equal(track.artworkTag, null);
    assert.deepEqual(track.tags, []);
    assert.equal(track.chapters, undefined);

    const bare = toTrack({ Id: 'ffffffffffffffffffffffffffffff02', Type: 'Audio', MediaType: 'Audio' }, undefined, OPTIONS);
    assert.equal(bare?.filename, '');
    assert.equal(bare?.title, 'ffffffffffffffffffffffffffffff02', 'no name and no path: the id');

    const dotfile = toTrack({ Id: 'ffffffffffffffffffffffffffffff03', Type: 'Audio', MediaType: 'Audio', Path: '/m/.hidden' }, undefined, OPTIONS);
    assert.equal(dotfile?.title, '.hidden', 'a leading dot is not an extension');
});

test(`${TAG} artists are joined when there is no album artist; names and tags are trimmed`, () => {
    const track = toTrack({
        ...SECOND_AUDIO,
        Name: '  Spaced  ',
        AlbumArtist: '   ',
        Artists: ['One', 'Two'],
        Album: '  Collection ',
        Tags: [' Calm ', ''],
        Genres: ['  ', 'CALM', 'Night'],
    }, undefined, OPTIONS);
    assert.equal(track?.title, 'Spaced');
    assert.equal(track?.artist, 'One, Two');
    assert.equal(track?.album, 'Collection');
    assert.deepEqual(track?.tags, ['Calm', 'Night']);
});

test(`${TAG} chapters that fall outside the media are dropped entirely`, () => {
    const track = toTrack({ ...SECOND_AUDIO, Chapters: [{ StartPositionTicks: 120 * 10_000_000 }] }, undefined, OPTIONS);
    assert.equal(track?.chapters, undefined);
    assert.equal(track?.chaptersSource, undefined);
    assert.equal(toTrack({ ...SECOND_AUDIO, Chapters: [] }, undefined, OPTIONS)?.chapters, undefined);
});

test(`${TAG} files that are not funscripts are left out of the listing`, () => {
    const track = toTrack(VIDEO, [
        { Key: 'k1', FileName: 'Clip_180_LR.srt' },
        { Key: 'k2', FileName: 'Clip_180_LR.funscript' },
    ], OPTIONS);
    assert.deepEqual(track?.funscripts, [{ key: 'k2', filename: 'Clip_180_LR.funscript', type: 'unknown' }]);
});

test(`${TAG} trickplay skips unusable resolutions and media sources`, () => {
    const usable = { Width: 480, Height: 270, TileWidth: 3, TileHeight: 3, ThumbnailCount: 5, Interval: 2_000 };
    assert.equal(trickplayOf({ ...VIDEO, Trickplay: null }), undefined);
    assert.equal(trickplayOf({ ...VIDEO, Trickplay: { empty: {} } }), undefined);
    const info = trickplayOf({
        ...VIDEO,
        Trickplay: {
            broken: {
                '320': { ...usable, ThumbnailCount: 0 },
                '321': { ...usable, Interval: 0 },
                wide: usable,
            },
            good: { '480': usable, '1280': { ...usable, Width: 1280 } },
        },
    });
    assert.equal(info?.mediaSourceId, 'good', 'the first source with a usable resolution');
    assert.equal(info?.resolution, 480, 'closest to 320');
    assert.equal(info?.intervalSeconds, 2);

    assert.equal(toTrack({ ...AUDIO, Trickplay: VIDEO.Trickplay }, undefined, OPTIONS)?.trickplay, undefined, 'audio never gets a storyboard');
});

test(`${TAG} playlists fall back to a generic name and carry their year`, () => {
    const library = buildLibrary([AUDIO], {}, [
        { item: { Id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1', Name: '  ', Type: 'Playlist', ProductionYear: 2023 }, entries: [AUDIO, AUDIO] },
        { item: { Id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2', Type: 'Playlist' }, entries: [AUDIO] },
    ], OPTIONS);
    assert.deepEqual(library.playlists.map((p) => [p.name, p.year]), [['Playlist', '2023'], ['Playlist', '']]);
    assert.deepEqual(library.playlists[0].entries, [
        { order: 0, trackId: AUDIO.Id, title: 'First Track', artist: 'Artist', album: 'Collection' },
        { order: 1, trackId: AUDIO.Id, title: 'First Track', artist: 'Artist', album: 'Collection' },
    ]);
    assert.equal(library.playlists[0].durationSeconds, 2 * 1234, 'a track listed twice counts twice');
});
