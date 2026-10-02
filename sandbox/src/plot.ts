import { INTERPOLATION_METHODS, positionAt, prepareScript } from '../../src/shared/interpolation';
import type { FunscriptAction } from '../../src/shared/types';
import { effectiveLevel, type AppPlayback } from './appModel';
import { describeFrames, idealLevel, type SimulationInput, type SimulationResult } from './simulate';

export interface PlotInput {
    actions: readonly FunscriptAction[];
    sim: SimulationInput;
    result: SimulationResult;
    app: AppPlayback;
    /** Plotly keeps the user's zoom until this changes. */
    revision: string;
}

/** Enough points to look smooth at full width without slowing down long windows. */
function sampleTimes(t0: number, t1: number): number[] {
    const step = Math.max(5, (t1 - t0) / 20_000);
    const times: number[] = [];
    for (let t = t0; t <= t1; t += step) times.push(t);
    return times;
}

function axis(title: string, range: [number, number]): object {
    return { title: { text: title }, range, gridcolor: '#343a40', zerolinecolor: '#495057' };
}

export function renderPlot(el: HTMLElement, input: PlotInput): Promise<PlotlyElement> {
    const { sim, result, app } = input;
    const xs = sampleTimes(sim.t0, sim.t1);
    const inView = input.actions.filter((a) => a.at >= sim.t0 && a.at <= sim.t1);
    const strengths = result.commands.flatMap((c) => c.command.kind === 'strength' ? [{ at: c.at, ...c.command }] : []);
    const batches = result.commands.flatMap((c) => c.command.kind === 'pulse' ? [{ at: c.at, ...c.command }] : []);

    const pulseX: (number | null)[] = [];
    const pulseY: (number | null)[] = [];
    for (const p of app.pulses) {
        pulseX.push(p.at, p.at, null);
        pulseY.push(0, p.amplitude, null);
    }

    const data: object[] = [
        ...INTERPOLATION_METHODS.map((method) => {
            const active = method === sim.script.method;
            const script = active ? sim.script : prepareScript(input.actions, method);
            return {
                type: 'scatter', mode: 'lines', name: `${method}${active ? ' (active)' : ''}`,
                legendgroup: 'position', legendgrouptitle: { text: '1. Position' },
                x: xs, y: xs.map((t) => positionAt(script, t)),
                visible: active ? true : 'legendonly', yaxis: 'y',
            };
        }),
        {
            type: 'scatter', mode: 'markers', name: 'actions', legendgroup: 'position',
            x: inView.map((a) => a.at), y: inView.map((a) => a.pos), marker: { size: 6, color: '#fd7e14' }, yaxis: 'y',
        },
        {
            type: 'scatter', mode: 'markers', name: 'sync ticks', legendgroup: 'position', visible: 'legendonly',
            x: result.ticks.map((t) => t.at), y: result.ticks.map((t) => t.position ?? 0),
            marker: { size: 3, color: '#adb5bd' }, yaxis: 'y',
        },
        {
            type: 'scatter', mode: 'lines+markers', name: 'SetTempIntensity',
            legendgroup: 'sent', legendgrouptitle: { text: '2. Sent to app' },
            x: strengths.map((s) => s.at), y: strengths.map((s) => s.value), customdata: strengths.map((s) => s.durationMs),
            line: { shape: 'hv', width: 1, color: '#ffc107' }, marker: { size: 4 },
            hovertemplate: 'SetTempIntensity v=%{y} d=%{customdata} ms<br>%{x:.0f} ms<extra></extra>', yaxis: 'y2',
        },
        {
            type: 'scatter', mode: 'markers', name: 'AppendPulseData', legendgroup: 'sent',
            x: batches.map((b) => b.at), y: batches.map(() => 0),
            hovertext: batches.map((b) => `d=${b.durationMs} ms<br>${describeFrames(b.frames)}`),
            hovertemplate: 'AppendPulseData %{x:.0f} ms<br>%{hovertext}<extra></extra>',
            marker: { symbol: 'triangle-up', size: 9, color: '#20c997' }, yaxis: 'y2',
        },
        {
            type: 'scatter', mode: 'lines', name: 'width %', legendgroup: 'steps', legendgrouptitle: { text: '3. Frame steps' },
            x: app.steps.map((s) => s.at), y: app.steps.map((s) => s.periodMs === null ? null : s.width),
            line: { shape: 'hv', color: '#0dcaf0' }, yaxis: 'y3',
        },
        {
            type: 'scatter', mode: 'lines', name: 'rate Hz', legendgroup: 'steps',
            x: app.steps.map((s) => s.at), y: app.steps.map((s) => s.periodMs === null ? null : 1000 / s.periodMs),
            line: { shape: 'hv', color: '#d63384' }, yaxis: 'y3',
        },
        {
            type: 'scattergl', mode: 'lines', name: 'pulses', legendgroup: 'output', legendgrouptitle: { text: '4. Output' },
            x: pulseX, y: pulseY, line: { width: 1, color: 'rgba(110,168,254,0.6)' }, hoverinfo: 'skip', yaxis: 'y4',
        },
        {
            type: 'scatter', mode: 'lines', name: 'ideal', legendgroup: 'output',
            x: xs, y: xs.map((t) => idealLevel(sim, t)), line: { dash: 'dash', color: '#adb5bd', width: 1 }, yaxis: 'y4',
        },
        {
            type: 'scatter', mode: 'lines', name: 'strength per frame', legendgroup: 'output',
            x: app.frames.map((f) => f.at), y: app.frames.map((f) => f.strength),
            line: { shape: 'hv', color: '#dc3545' }, yaxis: 'y4',
        },
        {
            type: 'scatter', mode: 'lines', name: 'effective', legendgroup: 'output',
            x: app.steps.map((s) => s.at), y: app.steps.map((s) => effectiveLevel(s, sim.pulse.width)),
            line: { shape: 'hv', color: '#198754' }, yaxis: 'y4',
        },
    ];

    const top = Math.max(1, sim.ceiling) * 1.05;
    const layout = {
        grid: { rows: 4, columns: 1, pattern: 'coupled', roworder: 'top to bottom' },
        height: 1100,
        margin: { l: 60, r: 20, t: 20, b: 40 },
        paper_bgcolor: '#212529',
        plot_bgcolor: '#1a1d20',
        font: { color: '#dee2e6' },
        hovermode: 'closest',
        uirevision: input.revision,
        legend: { groupclick: 'toggleitem' },
        xaxis: { title: { text: 'time (ms)' }, gridcolor: '#343a40' },
        yaxis: axis('position', [0, 105]),
        yaxis2: axis('strength sent', [-top * 0.05, top]),
        yaxis3: axis('width % / rate Hz', [0, 105]),
        yaxis4: axis('strength out', [0, top]),
    };
    return Plotly.react(el, data, layout, { responsive: true, displaylogo: false, scrollZoom: true });
}
