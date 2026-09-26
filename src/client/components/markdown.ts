import MarkdownIt from 'markdown-it';

export namespace Markdown {
    const md = new MarkdownIt({
        html: false,
        linkify: true,
        typographer: false,
    });
    export function render(markdown: string): string {
        return md.render(markdown);
    }

    export interface DocLinks {
        pageHref(page: string, hash: string): string;
        assetHref(relativePath: string): string;
    }

    const DOC_LINK = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/;
    const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
    const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/)/i;

    /** Matches GitHub's heading anchors so `page.md#section` links work in both places. */
    export function slugify(text: string): string {
        return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    }

    const docs = new MarkdownIt({ html: false, linkify: true, typographer: false });
    const renderToken: MarkdownIt.Renderer.RenderRule = (tokens, idx, options, _env, self) =>
        self.renderToken(tokens, idx, options);

    docs.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
        const used: Map<string, number> = env.slugs;
        const base = slugify(tokens[idx + 1]?.content ?? '');
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        tokens[idx].attrSet('id', count ? `${base}-${count}` : base);
        return renderToken(tokens, idx, options, env, self);
    };

    docs.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const href = token.attrGet('href') ?? '';
        const links: DocLinks = env.links;
        const docMatch = DOC_LINK.exec(href);
        if (docMatch) {
            token.attrSet('href', links.pageHref(docMatch[1], docMatch[2] ?? ''));
            token.attrSet('data-doc-link', '');
        } else if (EXTERNAL.test(href)) {
            token.attrSet('target', '_blank');
            token.attrSet('rel', 'noopener noreferrer');
        }
        return renderToken(tokens, idx, options, env, self);
    };

    const defaultImage = docs.renderer.rules.image!;
    docs.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const src = token.attrGet('src') ?? '';
        const links: DocLinks = env.links;
        if (src && !ABSOLUTE.test(src)) token.attrSet('src', links.assetHref(src.replace(/^\.\//, '')));
        return defaultImage(tokens, idx, options, env, self);
    };

    /** Renders a docs page, pointing relative page and image links at the in-app routes. */
    export function renderDoc(markdown: string, links: DocLinks): string {
        return docs.render(markdown, { links, slugs: new Map<string, number>() });
    }
}
