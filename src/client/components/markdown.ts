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
}
