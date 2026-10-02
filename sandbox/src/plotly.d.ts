/** The slice of the Plotly CDN global the sandbox uses. */
interface PlotlyElement extends HTMLElement {
    on(event: 'plotly_relayout', handler: (update: Record<string, unknown>) => void): void;
}

declare const Plotly: {
    react(el: HTMLElement, data: object[], layout: object, config?: object): Promise<PlotlyElement>;
};
