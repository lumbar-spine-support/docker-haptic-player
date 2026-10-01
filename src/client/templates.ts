import detailRowTemplate from './templates/detail-row.html';
import { renderTemplate } from './utils/template';

export function detailRowHtml(values: {
    order: string;
    title: string;
    artist: string;
    album: string;
    hapticIcons: string;
}): string {
    return renderTemplate(detailRowTemplate, values);
}
