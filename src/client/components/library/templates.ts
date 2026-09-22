import cardTemplate from './templates/card.html';
import sectionHeadingTemplate from './templates/section-heading.html';
import mediaRowTemplate from './templates/media-row.html';
import emptyStateTemplate from './templates/empty-state.html';
import tagChipActiveTemplate from './templates/tag-chip-active.html';
import { renderTemplate } from '../../utils/template';

export function cardHtml(values: {
    href: string;
    artSrc: string;
    fallbackArt: string;
    altText: string;
    title: string;
    artist: string;
    meta: string;
}): string {
    return renderTemplate(cardTemplate, values);
}

export function sectionHeadingHtml(values: { title: string }): string {
    return renderTemplate(sectionHeadingTemplate, values);
}

export function mediaRowHtml(values: {
    artSrc: string;
    fallbackArt: string;
    title: string;
    artist: string;
    type: string;
    year: string;
    duration: string;
    hapticIcons: string;
}): string {
    return renderTemplate(mediaRowTemplate, values);
}

export function emptyStateHtml(values: { message: string }): string {
    return renderTemplate(emptyStateTemplate, values);
}

export function tagChipActiveHtml(values: { tag: string }): string {
    return renderTemplate(tagChipActiveTemplate, values);
}
