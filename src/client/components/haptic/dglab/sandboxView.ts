import { qs } from '../../../utils/html';
import { STEP_DURATION_MS, positionStep, pulsePeriodMs } from './waveform';
import type { CoyoteBackend, CoyoteOutputChannel } from './coyoteBackend';
import { DEFAULT_PATTERN_ID, WAVEFORM_PATTERNS, patternCycleMs, patternSampler, type WaveformPattern } from './patterns';

/** Matches the default `FunscriptSync` rate. */
const SEND_INTERVAL_MS = 1000 / 30;
const MIN_WINDOW_MS = 2000;

/**
 * `?view=dglab-sandbox`: plays a built-in pattern on one Coyote channel, so
 * strength and pulse settings can be tried without funscript media.
 */
export class DglabSandbox {
    private readonly view = qs<HTMLElement>('#dglab-sandbox-view');
    private readonly channelSelect = qs<HTMLSelectElement>('#dglab-sandbox-channel');
    private readonly patternSelect = qs<HTMLSelectElement>('#dglab-sandbox-pattern');
    private readonly toggleButton = qs<HTMLButtonElement>('#btn-dglab-sandbox-toggle');
    private readonly info = qs<HTMLElement>('#dglab-sandbox-info');
    private readonly canvas = qs<HTMLCanvasElement>('#dglab-sandbox-canvas');

    private pattern: WaveformPattern = WAVEFORM_PATTERNS.find((p) => p.id === DEFAULT_PATTERN_ID)!;
    private sample = patternSampler(this.pattern);
    private startedAt: number | null = null;
    private timer: number | null = null;
    private frame = 0;

    constructor(private readonly coyote: CoyoteBackend, private readonly beforeStart: () => void) {
        for (const p of WAVEFORM_PATTERNS) this.patternSelect?.add(new Option(p.label, p.id, false, p === this.pattern));
        this.patternSelect?.addEventListener('change', () => {
            this.pattern = WAVEFORM_PATTERNS.find((p) => p.id === this.patternSelect?.value) ?? this.pattern;
            this.sample = patternSampler(this.pattern);
            if (this.startedAt !== null) this.startedAt = performance.now();
            this.render();
        });
        this.channelSelect?.addEventListener('change', () => {
            if (this.startedAt !== null) void this.stop();
            this.render();
        });
        this.toggleButton?.addEventListener('click', () => {
            if (this.startedAt === null) this.start();
            else void this.stop();
        });
        const refresh = () => { if (this.isVisible) this.refreshChannels(); };
        coyote.onDevicesChange(refresh);
        coyote.onDeviceStateChange(refresh);
        coyote.onStateChange(refresh);
        // Strength and rate sliders live in the settings panel.
        document.getElementById('settings-panel')?.addEventListener('hidden.bs.offcanvas', refresh);
        window.addEventListener('resize', refresh);
    }

    private get isVisible(): boolean {
        return !!this.view && !this.view.classList.contains('d-none');
    }

    show(): void {
        this.view?.classList.remove('d-none');
        document.title = 'DG-Lab Sandbox — HAPPY';
        this.refreshChannels();
    }

    hide(): void {
        if (this.startedAt !== null) void this.stop();
        this.view?.classList.add('d-none');
    }

    private selected(): CoyoteOutputChannel | null {
        const channels = this.coyote.getOutputChannels();
        return channels.find((c) => c.featureId === this.channelSelect?.value) ?? channels[0] ?? null;
    }

    private refreshChannels(): void {
        if (!this.channelSelect) return;
        const current = this.channelSelect.value;
        const channels = this.coyote.getOutputChannels();
        this.channelSelect.replaceChildren(...channels.map((c) => new Option(c.label, c.featureId, false, c.featureId === current)));
        if (channels.length === 0 && this.startedAt !== null) void this.stop();
        this.render();
    }

    private start(): void {
        const channel = this.selected();
        if (!channel || this.coyote.connectionState !== 'connected') return;
        this.beforeStart();
        this.startedAt = performance.now();
        const tick = () => {
            if (this.startedAt === null) return;
            const elapsed = performance.now() - this.startedAt;
            this.coyote.sendToFeature(channel.featureId, (offsetMs) => this.sample(elapsed + offsetMs));
        };
        tick();
        this.timer = window.setInterval(tick, SEND_INTERVAL_MS);
        const animate = () => {
            this.render();
            if (this.startedAt !== null) this.frame = requestAnimationFrame(animate);
        };
        this.frame = requestAnimationFrame(animate);
    }

    private async stop(): Promise<void> {
        this.startedAt = null;
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        cancelAnimationFrame(this.frame);
        await this.coyote.stopAll();
        this.render();
    }

    private render(): void {
        const channel = this.selected();
        const connected = this.coyote.connectionState === 'connected';
        const running = this.startedAt !== null;
        if (this.toggleButton) {
            this.toggleButton.disabled = !channel || !connected;
            this.toggleButton.classList.toggle('btn-danger', running);
            this.toggleButton.classList.toggle('btn-primary', !running);
            this.toggleButton.textContent = running ? 'Stop' : 'Start';
        }
        if (this.info) {
            this.info.textContent = !connected ? 'Connect the DG-Lab app in the settings first.'
                : !channel ? 'No Coyote reported by the DG-Lab app.'
                    : `Strength ${channel.level} / ${channel.ceiling} · pulse rate ${channel.pulse.frequency} Hz`;
        }
        this.draw(channel);
    }

    /** Pattern position, and the pulses each 25 ms step would play: height is strength × width. */
    private draw(channel: CoyoteOutputChannel | null): void {
        const canvas = this.canvas;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const cycle = patternCycleMs(this.pattern);
        const windowMs = Math.max(MIN_WINDOW_MS, cycle * Math.ceil(MIN_WINDOW_MS / cycle));
        const pad = 4;
        const x = (ms: number) => (ms / windowMs) * width;
        const y = (fraction: number) => height - pad - fraction * (height - 2 * pad);
        const ceiling = Math.max(1, channel?.ceiling ?? 1);
        const level = channel?.level ?? 0;
        const pulse = channel?.pulse ?? { frequency: 50 };

        ctx.strokeStyle = 'rgba(220, 53, 69, 0.8)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y(level / ceiling));
        ctx.lineTo(width, y(level / ceiling));
        ctx.stroke();
        ctx.setLineDash([]);

        // Pulses keep their spacing across steps, like the device does at rates above 40 Hz.
        ctx.strokeStyle = 'rgba(110, 168, 254, 0.7)';
        ctx.beginPath();
        const period = pulsePeriodMs(pulse.frequency);
        for (let at = 0; at < windowMs; at += period) {
            const stepStart = Math.floor(at / STEP_DURATION_MS) * STEP_DURATION_MS;
            const stepWidth = positionStep(this.sample(stepStart), pulse.frequency).width;
            const amplitude = (level / ceiling) * (stepWidth / 100);
            if (amplitude <= 0) continue;
            ctx.moveTo(x(at), y(0));
            ctx.lineTo(x(at), y(amplitude));
        }
        ctx.stroke();

        ctx.strokeStyle = '#fd7e14';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let px = 0; px <= width; px += 2) {
            const pos = this.sample((px / width) * windowMs);
            if (px === 0) ctx.moveTo(px, y(pos));
            else ctx.lineTo(px, y(pos));
        }
        ctx.stroke();
        ctx.lineWidth = 1;

        if (this.startedAt !== null) {
            const head = (performance.now() - this.startedAt) % windowMs;
            // The playhead follows the theme's text colour; the signal colours above are fixed.
            ctx.strokeStyle = getComputedStyle(canvas).color;
            ctx.beginPath();
            ctx.moveTo(x(head), 0);
            ctx.lineTo(x(head), height);
            ctx.stroke();
        }
    }
}
