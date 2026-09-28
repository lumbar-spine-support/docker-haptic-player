import test from 'node:test';
import assert from 'node:assert/strict';
import {
    albumMatchesActiveTags,
    artistTagValue,
    countMediaMatches,
    filterAvailableTags,
    isArtistTag,
    makeArtistTag,
    playlistMatchesActiveTags,
    splitActiveTags,
    trackMatchesActiveTags,
} from '../../src/shared/libraryFiltering';

const TAG = '[shared:libraryFiltering]';

test(`${TAG} artist tag helpers round-trip`, () => {
    assert.equal(makeArtistTag('Kinkyshibby'), 'artist:Kinkyshibby');
    assert.equal(isArtistTag('artist:Kinkyshibby'), true);
    assert.equal(isArtistTag('Artist:Kinkyshibby'), true);
    assert.equal(isArtistTag('kinky'), false);
    assert.equal(artistTagValue('artist:Kinkyshibby'), 'Kinkyshibby');
    assert.equal(artistTagValue('kinky'), 'kinky');
});

test(`${TAG} filterAvailableTags excludes selected and artist tags and applies query`, () => {
    const all = ['ASMR', 'artist:Foo', 'sfw', 'story'];
    assert.deepEqual(filterAvailableTags(all, ['asmr'], ''), ['sfw', 'story']);
    assert.deepEqual(filterAvailableTags(all, [], 'S'), ['ASMR', 'sfw', 'story']);
    assert.deepEqual(filterAvailableTags(all, [], 'st'), ['story']);
});

test(`${TAG} countMediaMatches counts per media type and ignores artist entries`, () => {
    const track = (id: string, tags: string[]) => ({ id, tags, artist: 'A', funscripts: [] }) as never;
    const library = {
        tracks: [track('t1', ['asmr']), track('t2', ['sfw'])],
        videos: [track('v1', ['asmr'])],
        albums: [{ trackIds: ['t1'] }, { trackIds: ['t2'] }] as never[],
        playlists: [{ entries: [{ trackId: 't2' }] }] as never[],
    };
    assert.deepEqual(countMediaMatches(library, []), { albums: 2, tracks: 2, playlists: 1, videos: 1 });
    assert.deepEqual(countMediaMatches(library, ['asmr', 'artist:Nobody']), { albums: 1, tracks: 1, playlists: 0, videos: 1 });
});

test(`${TAG} splitActiveTags separates artists from plain tags`, () => {
    assert.deepEqual(splitActiveTags(['asmr', 'artist:Kinkyshibby', 'sfw']), {
        tags: ['asmr', 'sfw'],
        artists: ['Kinkyshibby'],
    });
});

test(`${TAG} trackMatchesActiveTags honours artist filters case-insensitively`, () => {
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:kinkyshibby'], 'Kinkyshibby'), true);
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:kinkyshibby'], 'Someone Else'), false);
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:Kinkyshibby', 'asmr'], 'Kinkyshibby'), true);
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:Kinkyshibby', 'sfw'], 'Kinkyshibby'), false);
});

test(`${TAG} multiple artist filters are OR-ed`, () => {
    const filters = ['artist:A', 'artist:B'];
    assert.equal(trackMatchesActiveTags([], filters, 'A'), true);
    assert.equal(trackMatchesActiveTags([], filters, 'B'), true);
    assert.equal(trackMatchesActiveTags([], filters, 'C'), false);
});

test(`${TAG} albumMatchesActiveTags matches on album or member track artist`, () => {
    const tracksById = new Map([['t1', { tags: ['asmr'], funscripts: [], artist: 'Track Artist' }]]);
    const album = { trackIds: ['t1'], artist: 'Kinkyshibby' };
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Kinkyshibby']), true);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Track Artist']), true);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Nobody']), false);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Kinkyshibby', 'asmr']), true);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Kinkyshibby', 'sfw']), false);
});

test(`${TAG} playlistMatchesActiveTags matches on entry artist`, () => {
    const tracksById = new Map([['t1', { tags: ['asmr'], funscripts: [], artist: 'Track Artist' }]]);
    const playlist = { entries: [{ trackId: 't1', artist: 'Entry Artist' }] } as any;
    assert.equal(playlistMatchesActiveTags(playlist, tracksById, ['artist:Entry Artist']), true);
    assert.equal(playlistMatchesActiveTags(playlist, tracksById, ['artist:Track Artist']), true);
    assert.equal(playlistMatchesActiveTags(playlist, tracksById, ['artist:Nobody']), false);
});
