import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES } from '../../src/shared/types';

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

    it('uses no colour variables from before the theme tokens', () => {
        const sources = readdirSync('.', { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile() && /\.(scss|css|ts|html)$/.test(entry.name))
            .map((entry) => join(entry.parentPath, entry.name))
            .filter((file) => /^(public\/css\/(scss|themes)|src|@)\//.test(file));
        const offenders = sources.filter((file) => readFileSync(file, 'utf8').includes('--app-color-'));
        assert.deepEqual(offenders, [], 'use the --happy-* tokens or --bs-danger');
    });

    it('ships a stylesheet for every theme the plugin offers', () => {
        const plugin = readFileSync('jellyfin-plugin/Jellyfin.Plugin.Happy/Configuration/ClientSettings.cs', 'utf8');
        const pluginThemes = /Themes = \[([^\]]*)\]/.exec(plugin)?.[1].match(/"[^"]+"/g)?.map((s) => s.slice(1, -1));
        assert.deepEqual(pluginThemes, [...THEMES]);
        const configPage = readFileSync('jellyfin-plugin/Jellyfin.Plugin.Happy/Configuration/configPage.html', 'utf8');
        for (const theme of THEMES) {
            assert.ok(existsSync(`public/css/themes/${theme}.scss`), `public/css/themes/${theme}.scss`);
            assert.ok(configPage.includes(`<option value="${theme}">`), `configPage.html offers ${theme}`);
        }
    });

    it('loads the chosen theme after the app stylesheet', () => {
        const index = readFileSync('public/index.html', 'utf8');
        const app = index.indexOf('href="css/app.css"');
        assert.ok(app > 0 && index.indexOf('href="theme.css"') > app);
    });

    it('uses the theme surfaces instead of fixed Bootstrap backgrounds', () => {
        const fixed = /\b(?:bg-dark|bg-black|btn-dark)\b/;
        const files = ['public/index.html', ...htmlFiles('src/client'), ...htmlFiles('@/components')];
        const offenders = files.filter((file) => fixed.test(readFileSync(file, 'utf8')));
        assert.deepEqual(offenders, [], 'use bg-surface, bg-app or btn-surface');
    });
});
