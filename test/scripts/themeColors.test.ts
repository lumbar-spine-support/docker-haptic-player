import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Themes only swap the --happy-* tokens, so colours must not be hardcoded elsewhere.
// _variables.scss holds the theme-independent constants (scrims over video), the
// Bootstrap theme its compile-time values; themes/ holds the palettes.
const SCSS_DIR = 'public/css/scss';
const ALLOWED_SCSS = new Set(['_variables.scss', '_bootstrap-theme.scss']);
const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|(?<![-\w])(?:white|black)(?![-\w])/;

function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function htmlFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
        .map((entry) => join(entry.parentPath, entry.name));
}

describe('theme colours', () => {
    it('keeps literal colours out of the app stylesheets', () => {
        const offenders = readdirSync(SCSS_DIR)
            .filter((name) => name.endsWith('.scss') && !ALLOWED_SCSS.has(name))
            .flatMap((name) => withoutComments(readFileSync(join(SCSS_DIR, name), 'utf8'))
                .split('\n')
                .map((line, i) => ({ where: `${name}:${i + 1}`, line: line.trim() }))
                .filter(({ line }) => LITERAL_COLOUR.test(line)));
        assert.deepEqual(offenders, [], 'use a --happy-* token (or a constant in _variables.scss)');
    });

    it('uses the theme surfaces instead of fixed Bootstrap backgrounds', () => {
        const fixed = /\b(?:bg-dark|bg-black|btn-dark)\b/;
        const files = ['public/index.html', ...htmlFiles('src/client'), ...htmlFiles('@/components')];
        const offenders = files.filter((file) => fixed.test(readFileSync(file, 'utf8')));
        assert.deepEqual(offenders, [], 'use bg-surface, bg-app or btn-surface');
    });
});
