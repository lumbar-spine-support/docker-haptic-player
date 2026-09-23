import test from 'node:test';
import assert from 'node:assert/strict';
import {
    albumMatchesActiveTags,
    artistTagValue,
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
