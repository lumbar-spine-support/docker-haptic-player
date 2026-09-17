import test from 'node:test';
import assert from 'node:assert/strict';
import { Markdown } from '../../src/client/components/markdown';

const TAG = '[client:markdown]';

test(`${TAG} should render markdown correctly`, async () => {
    const markdown = '# Hello World';
    const rendered = Markdown.render(markdown);
    assert.ok(rendered.includes('Hello World'));
});