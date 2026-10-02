import {
    DEFAULT_INTERPOLATION_METHOD,
    INTERPOLATION_METHODS,
    isInterpolationMethod,
    prepareScript,
} from '../../src/shared/interpolation';
import type { FunscriptAction } from '../../src/shared/types';
import {
    DEFAULT_PULSE_FREQUENCY,
    DEFAULT_PULSE_WIDTH,
    MAX_PULSE_FREQUENCY,
    MAX_PULSE_WIDTH,
    MIN_PULSE_FREQUENCY,
    MIN_PULSE_WIDTH,
    clampFrequency,
    clampPulseWidth,
} from '../../src/client/components/haptic/dglab/waveform';
import { playOnApp } from './appModel';
import { renderPlot } from './plot';
import { describeFrames, runSyncLoop, summarize, type SimulationInput, type TimedCommand } from './simulate';
import { STRATEGIES } from './strategies';

/** Slow strokes, fast 150 ms strokes, a hold, a pause and a ramp. */
const DEMO: FunscriptAction[] = [
    [0, 0], [600, 100], [1200, 20], [1800, 80], [2400, 10], [2550, 90], [2700, 10], [2850, 90],
    [3000, 10], [3150, 90], [3300, 50], [4300, 50], [4400, 0], [5400, 0], [6400, 100],
].map(([at, pos]) => ({ at: at!, pos: pos! }));

const DEFAULT_WINDOW_MS = 60_000;
const MAX_TABLE_ROWS = 300;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const num = (id: string, fallback: number) => {
    const value = input(id).valueAsNumber;
    return Number.isFinite(value) ? value : fallback;
};

let actions = DEMO;
let sourceName = 'demo script';
let revision = 0;
let lastCommands: TimedCommand[] = [];

function fillSelect(id: string, options: readonly { value: string; label: string }[], selected: string): void {
    const select = $<HTMLSelectElement>(id);
    for (const { value, label } of options) select.add(new Option(label, value, false, value === selected));
}

function setNumber(id: string, min: number, max: number, value: number): void {
    Object.assign(input(id), { min: String(min), max: String(max), value: String(value) });
}

function isAction(value: unknown): value is FunscriptAction {
    const a = value as { at?: unknown; pos?: unknown } | null;
    return typeof a?.at === 'number' && typeof a.pos === 'number';
}

function parseFunscript(text: string): FunscriptAction[] {
    const data = JSON.parse(text) as { actions?: unknown };
    if (!Array.isArray(data.actions)) throw new Error('no "actions" array');
    const parsed = data.actions.filter(isAction);
    if (parsed.length < 2) throw new Error('a script needs at least two actions');
    return parsed;
}

function resetWindow(): void {
    const first = Math.min(...actions.map((a) => a.at));
    const last = Math.max(...actions.map((a) => a.at));
    input('t0').value = String(Math.floor(first / 1000));
    input('t1').value = String(Math.ceil(Math.min(last + 1000, first + DEFAULT_WINDOW_MS) / 1000));
}

function readInput(): SimulationInput {
    const method = $<HTMLSelectElement>('method').value;
    const strategy = STRATEGIES.find((s) => s.id === $<HTMLSelectElement>('strategy').value) ?? STRATEGIES[0]!;
    const t0 = num('t0', 0) * 1000;
    return {
        strategy,
        script: prepareScript(actions, isInterpolationMethod(method) ? method : DEFAULT_INTERPOLATION_METHOD),
        t0,
        t1: Math.max(t0 + 1000, num('t1', 0) * 1000),
        tickHz: Math.min(240, Math.max(10, num('tickHz', 30))),
        strength: num('strength', 100) / 100,
        ceiling: Math.min(200, Math.max(0, num('ceiling', 40))),
        pulse: { frequency: clampFrequency(num('frequency', DEFAULT_PULSE_FREQUENCY)), width: clampPulseWidth(num('width', DEFAULT_PULSE_WIDTH)) },
        latencyMs: Math.max(0, num('latency', 40)),
    };
}

function renderTable(from: number, to: number): void {
    const body = $<HTMLTableSectionElement>('commands');
    const visible = lastCommands.filter((c) => c.at >= from && c.at <= to);
    const rows = visible.slice(0, MAX_TABLE_ROWS).map(({ at, command }) => {
        const row = document.createElement('tr');
        const payload = command.kind === 'strength'
            ? `v=${command.value} d=${command.durationMs}`
            : `d=${command.durationMs} ${describeFrames(command.frames)}`;
        for (const text of [at.toFixed(0), command.kind === 'strength' ? 'SetTempIntensity' : 'AppendPulseData', payload]) {
            row.insertCell().textContent = text;
        }
        return row;
    });
    body.replaceChildren(...rows);
    $('table-note').textContent = visible.length > MAX_TABLE_ROWS
        ? `(first ${MAX_TABLE_ROWS} of ${visible.length}; zoom in to narrow)`
        : `(${visible.length})`;
}

let listening = false;

async function render(): Promise<void> {
    const error = $('error');
    try {
        const sim = readInput();
        const result = runSyncLoop(sim);
        const app = playOnApp(result.commands, sim.t0, sim.t1, sim.latencyMs);
        const stats = summarize(sim, result, app);
        lastCommands = result.commands;

        $('source').textContent = `${sourceName} (${actions.length} actions)`;
        $('description').textContent = sim.strategy.description;
        $('stats').textContent = `SetTempIntensity ${stats.strengthPerSecond.toFixed(1)}/s · `
            + `AppendPulseData ${stats.pulsePerSecond.toFixed(2)}/s · `
            + `RMS error vs ideal ${stats.rmsError.toFixed(2)} of ${sim.ceiling}`;

        const plot = await renderPlot($('plot'), { actions, sim, result, app, revision: String(revision) });
        if (!listening) {
            listening = true;
            plot.on('plotly_relayout', (update) => {
                const from = update['xaxis.range[0]'];
                const to = update['xaxis.range[1]'];
                if (typeof from === 'number' && typeof to === 'number') renderTable(from, to);
                else if (update['xaxis.autorange']) renderTable(-Infinity, Infinity);
            });
        }
        renderTable(-Infinity, Infinity);
        error.classList.add('d-none');
    } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        error.classList.remove('d-none');
    }
}

let pending: ReturnType<typeof setTimeout> | undefined;
function scheduleRender(): void {
    clearTimeout(pending);
    pending = setTimeout(() => void render(), 150);
}

function init(): void {
    fillSelect('strategy', STRATEGIES.map((s) => ({ value: s.id, label: s.label })), STRATEGIES[0]!.id);
    fillSelect('method', INTERPOLATION_METHODS.map((m) => ({ value: m, label: m })), DEFAULT_INTERPOLATION_METHOD);
    setNumber('frequency', MIN_PULSE_FREQUENCY, MAX_PULSE_FREQUENCY, DEFAULT_PULSE_FREQUENCY);
    setNumber('width', MIN_PULSE_WIDTH, MAX_PULSE_WIDTH, DEFAULT_PULSE_WIDTH);
    resetWindow();

    const form = $<HTMLFormElement>('controls');
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('input', (e) => { if ((e.target as HTMLElement).id !== 'file') scheduleRender(); });
    input('file').addEventListener('change', async () => {
        const file = input('file').files?.[0];
        if (!file) return;
        try {
            actions = parseFunscript(await file.text());
            sourceName = file.name;
            revision += 1;
            resetWindow();
            await render();
        } catch (err) {
            const error = $('error');
            error.textContent = `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
            error.classList.remove('d-none');
        }
    });
    void render();
}

init();
