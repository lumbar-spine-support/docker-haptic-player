import cardTemplate from './templates/card.html';
import playlistCardTemplate from './templates/playlist-card.html';
import sectionHeadingTemplate from './templates/section-heading.html';
import trackRowTemplate from './templates/track-row.html';
import sectionRowTemplate from './templates/section-row.html';
import albumRowTemplate from './templates/album-row.html';
import playlistRowTemplate from './templates/playlist-row.html';
import emptyStateTemplate from './templates/empty-state.html';
import tagChipActiveTemplate from './templates/tag-chip-active.html';
import { renderTemplate } from '../../utils/template';

export function cardHtml(values: {
    href: string;
    artSrc: string;
    fallbackArt: string;
    altText: string;
    title: string;
    subtitle: string;
    meta: string;
    hapticIcons: string;
}): string {
    return renderTemplate(cardTemplate, values);
}

export function playlistCardHtml(values: {
    href: string;
    artSrc: string;
    fallbackArt: string;
    name: string;
    subtitle: string;
    meta: string;
}): string {
    return renderTemplate(playlistCardTemplate, values);
}

export function sectionHeadingHtml(values: { title: string }): string {
    return renderTemplate(sectionHeadingTemplate, values);
}

export function trackRowHtml(values: {
    artSrc: string;
    fallbackArt: string;
    title: string;
    artist: string;
    album: string;
    year: string;
    duration: string;
    hapticIcons: string;
}): string {
    return renderTemplate(trackRowTemplate, values);
}

export function sectionRowHtml(values: { title: string }): string {
    return renderTemplate(sectionRowTemplate, values);
}

export function albumRowHtml(values: {
    artSrc: string;
    fallbackArt: string;
    title: string;
    artist: string;
    year: string;
    duration: string;
    hapticIcons: string;
}): string {
    return renderTemplate(albumRowTemplate, values);
}

export function playlistRowHtml(values: {
    artSrc: string;
    fallbackArt: string;
    name: string;
    artists: string;
    duration: string;
}): string {
    return renderTemplate(playlistRowTemplate, values);
}

export function emptyStateHtml(values: { message: string }): string {
    return renderTemplate(emptyStateTemplate, values);
}

export function tagChipActiveHtml(values: { tag: string }): string {
    return renderTemplate(tagChipActiveTemplate, values);
}
