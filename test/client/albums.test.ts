import test from 'node:test';
import assert from 'node:assert/strict';
import { albumId, buildAlbums } from '../../src/shared/albums';
import type { TrackInfo } from '../../src/shared/types';

const TAG = '[shared:albums]';

function track(overrides: Partial<TrackInfo>): TrackInfo {
    return {
        id: 't',
        type: 'audio',
        title: 'Title',
        filename: 'file.mp3',
        description: '',
        artist: 'Artist',
        album: 'Album',
        year: '',
        trackNumber: null,
        hasArtwork: false,
        artworkTag: null,
        durationSeconds: 10,
        funscripts: [],
        tags: [],
        isFavorite: false,
        ...overrides,
    } as TrackInfo;
}

test(`${TAG} albumId is stable, URL-safe and distinguishes artist from album`, () => {
    const id = albumId('Artist', 'Album');
    assert.equal(albumId('Artist', 'Album'), id);
    assert.match(id, /^album-[0-9a-z]+$/);
    assert.notEqual(albumId('Artist', 'Other'), id);
    assert.notEqual(albumId('ArtistA', 'lbum'), id, 'the separator keeps "Artist"+"Album" apart from "ArtistA"+"lbum"');
    assert.notEqual(albumId('', ''), albumId('', ' '));
});

test(`${TAG} tracks without an album tag are not grouped`, () => {
    assert.deepEqual(buildAlbums([track({ id: 'a', album: '' }), track({ id: 'b', album: '   ' })]), []);
    assert.deepEqual(buildAlbums([]), []);
});

test(`${TAG} the same album name by different artists makes separate albums`, () => {
    const albums = buildAlbums([
        track({ id: 'a', artist: 'One' }),
        track({ id: 'b', artist: 'Two' }),
        track({ id: 'c', artist: 'One' }),
    ]);
    assert.deepEqual(albums.map((a) => [a.artist, a.trackIds]), [['One', ['a', 'c']], ['Two', ['b']]]);
    assert.deepEqual(albums.map((a) => a.id), [albumId('One', 'Album'), albumId('Two', 'Album')]);
});

test(`${TAG} tracks are ordered by number, then year, title and filename; unnumbered last`, () => {
    const [album] = buildAlbums([
        track({ id: 'unnumbered' }),
        track({ id: 'n2', trackNumber: 2 }),
        track({ id: 'n1-2021', trackNumber: 1, year: '2021' }),
        track({ id: 'n1-2020-b', trackNumber: 1, year: '2020', title: 'B' }),
        track({ id: 'n1-2020-a-2', trackNumber: 1, year: '2020', title: 'A', filename: '2.mp3' }),
        track({ id: 'n1-2020-a-1', trackNumber: 1, year: '2020', title: 'A', filename: '1.mp3' }),
    ]);
    assert.deepEqual(album.trackIds, ['n1-2020-a-1', 'n1-2020-a-2', 'n1-2020-b', 'n1-2021', 'n2', 'unnumbered']);
    assert.equal(album.year, '2020', 'the year of the first track');
    assert.equal(album.trackCount, 6);
    assert.equal(album.durationSeconds, 60);
});

test(`${TAG} album fields: title, type, and a cover only from a track with artwork`, () => {
    const [noCover] = buildAlbums([track({ id: 'a' })]);
    assert.equal(noCover.coverTrackId, null, 'no cover rather than a guaranteed 404');
    assert.equal(noCover.type, 'album');
    assert.equal(noCover.title, 'Album');
    assert.equal(noCover.album, 'Album');

    const [withCover] = buildAlbums([
        track({ id: 'first', trackNumber: 1 }),
        track({ id: 'second', trackNumber: 2, hasArtwork: true }),
        track({ id: 'third', trackNumber: 3, hasArtwork: true }),
    ]);
    assert.equal(withCover.coverTrackId, 'second');
});

test(`${TAG} albums are sorted by title`, () => {
    const albums = buildAlbums([
        track({ id: 'z', album: 'Zulu' }),
        track({ id: 'a', album: 'alpha' }),
        track({ id: 'm', album: 'Mike' }),
    ]);
    assert.deepEqual(albums.map((a) => a.title), ['alpha', 'Mike', 'Zulu']);
});
