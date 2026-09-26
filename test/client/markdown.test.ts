import test from 'node:test';
import assert from 'node:assert/strict';
import { Markdown } from '../../src/client/components/markdown';

const TAG = '[client:markdown]';

test(`${TAG} should render markdown correctly`, async () => {
    const markdown = '# Hello World';
    const rendered = Markdown.render(markdown);
    assert.ok(rendered.includes('Hello World'));
});

const links: Markdown.DocLinks = {
    pageHref: (page, hash) => `/?view=docs&id=${page}${hash}`,
    assetHref: (p) => `/api/docs/assets/${p}`,
};

test(`${TAG} renderDoc rewrites relative doc links and images`, () => {
    const html = Markdown.renderDoc('[a](library.md#funscripts) ![s](screenshots/x.jpg) [e](https://example.com)', links);
    assert.ok(html.includes('href="/?view=docs&amp;id=library#funscripts" data-doc-link=""'));
    assert.ok(html.includes('src="/api/docs/assets/screenshots/x.jpg"'));
    assert.ok(html.includes('href="https://example.com" target="_blank" rel="noopener noreferrer"'));
});

test(`${TAG} renderDoc adds GitHub-style heading ids`, () => {
    const html = Markdown.renderDoc('## Funscript naming\n\n## DG-Lab Coyote 3.0 (experimental)\n\n## Funscript naming', links);
    assert.ok(html.includes('<h2 id="funscript-naming">'));
    assert.ok(html.includes('<h2 id="dg-lab-coyote-30-experimental">'));
    assert.ok(html.includes('<h2 id="funscript-naming-1">'));
});

test(`${TAG} renderDoc keeps raw HTML escaped`, () => {
    const html = Markdown.renderDoc('<script>alert(1)</script>', links);
    assert.ok(!html.includes('<script>'));
});