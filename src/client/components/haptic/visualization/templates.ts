import scriptRowTemplate from './templates/script-row.html';
import emptyStateTemplate from './templates/empty-state.html';
import { renderTemplate } from '../../../utils/template';

export function scriptRowHtml(values: { iconClass: string; label: string; channelKey: string }): string {
    return renderTemplate(scriptRowTemplate, values);
}

export function emptyStateHtml(): string {
    return renderTemplate(emptyStateTemplate, {});
}
