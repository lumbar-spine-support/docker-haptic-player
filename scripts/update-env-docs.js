// Script will look for comment in markdown files
// containing the marker ENV_OPTIONS and edit the
// corresponding sections.
// Run via `node --import tsx` so config.ts can be required directly.

const fs = require('fs');
const path = require('path');
const { Config } = require('../src/server/config.ts');

const MARKER = "ENV_OPTIONS"
const ROOT = path.resolve(__dirname, '..');
const FILES = ['README.md', ...fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => path.join('docs', f))];

const SECTION = new RegExp(`(<!-- ${MARKER} -->)[\\s\\S]*?(<!-- /${MARKER} -->)`, 'g');

function formatDefault(value) {
    const text = Array.isArray(value) ? value.join(',') : String(value);
    return text === '' ? '*(empty)*' : `\`${text}\``;
}

function escapeCell(text) {
    return text.replace(/\|/g, '\\|');
}

function buildTable() {
    const rows = Object.keys(Config.DEFAULTS)
        .filter(key => Config.ENV_NAMES[key])
        .map(key => `| \`${Config.ENV_NAMES[key]}\` | ${formatDefault(Config.DEFAULTS[key])} | ${escapeCell(Config.DESCRIPTIONS[key] ?? '')} |`);
    return ['| Setting | Default | Description |', '| --- | --- | --- |', ...rows].join('\n');
}

const table = buildTable();

for (const file of FILES) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    const original = fs.readFileSync(fullPath, 'utf-8');
    const updated = original.replace(SECTION, `$1\n\n${table}\n\n$2`);
    if (updated !== original) {
        fs.writeFileSync(fullPath, updated, 'utf-8');
        console.log(`Updated ${file}`);
    }
}
