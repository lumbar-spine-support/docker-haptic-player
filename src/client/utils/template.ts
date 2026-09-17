import { escapeHtml } from './html';

/**
 * Render a template string by substituting placeholders.
 * {{key}} is HTML-escaped; {{{key}}} is inserted raw.
 * Unknown keys are replaced with empty strings.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (match, rawKey, escapedKey) => {
        const key = rawKey || escapedKey;
        const value = values[key] ?? '';
        return rawKey ? value : escapeHtml(value);
    });
}
