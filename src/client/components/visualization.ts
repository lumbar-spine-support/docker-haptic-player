import type { Funscript } from '../../shared/types';
import { channelKey, channelLabel, type HapticChannel } from '../../shared/haptics';
import type { PlaybackSession } from './player';

interface ScriptRenderer {
  channel: HapticChannel;
  canvas: HTMLCanvasElement;
  wrapper: HTMLDivElement;
  funscript: Funscript;
}

/**
 * Renders a line graph for each loaded Funscript on a canvas element.
 *
 * Supports horizontal zoom (zoom > 1 magnifies around the playhead) and
 * uses Bootstrap theme colours for the cursor line.
 */
export class Visualization {
  private renderers: ScriptRenderer[] = [];
  private container: HTMLElement | null = null;
  private readonly session: PlaybackSession;
  private rafHandle = 0;
  private seekHandler: ((time: number) => void) | null = null;
  private seekLocked = true;
  private visible = true;

  /** Horizontal zoom factor (1 = full view, 2 = 2× zoom, etc.) */
  zoomLevel = 1;

  constructor(session: PlaybackSession) {
    this.session = session;
    session.onChange(() => {
      const { paused } = this.clock;
      if (paused) this.stopLoop();
      else this.startLoop();
      if (paused) this.redraw();
    });
  }

  /** Timeline of the player shown on the file page, which may not be the playing one. */
  private get clock(): { currentTime: number; duration: number; paused: boolean } {
    return this.session.focusedStore.state;
  }

  /**
   * Attach canvases to the container element and render the provided scripts.
   * Each script gets its own labelled canvas.
   */
  mount(
    container: HTMLElement,
    scripts: Array<{ channel: HapticChannel; funscript: Funscript }>,
  ): void {
    container.innerHTML = '';
    this.renderers = [];
    this.container = container;

    if (scripts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted small mb-0';
      empty.textContent = 'No scripts available for this track.';
      container.appendChild(empty);
      return;
    }

    for (const { channel, funscript } of scripts) {
      const wrapper = document.createElement('div');
      wrapper.className = 'mb-2';

      const header = document.createElement('div');
      header.className = 'd-flex align-items-center justify-content-between gap-2 mb-1';

      const label = document.createElement('div');
      label.className = 'd-flex align-items-center gap-2 text-muted small';

      const text = channelLabel(channel);

      const icon = document.createElement('span');
      icon.className = `device-role-icon device-role-icon-${channel.type}`;
      icon.title = text;
      icon.setAttribute('aria-hidden', 'true');

      const labelText = document.createElement('span');
      labelText.textContent = text;

      label.appendChild(icon);
      label.appendChild(labelText);

      const status = document.createElement('span');
      status.className = 'badge bg-secondary';
      status.dataset['deviceStatus'] = channelKey(channel);
      status.textContent = 'Disconnected';

      const canvas = document.createElement('canvas');
      canvas.className = 'w-100 d-block';
      canvas.height = 60;
      canvas.addEventListener('pointerdown', (event) => this.handleSeek(event, canvas));

      // Wrapper collapses via the grid 0fr technique while the header stays visible.
      const canvasWrap = document.createElement('div');
      canvasWrap.className = 'viz-canvas-wrap';
      canvasWrap.appendChild(canvas);

      header.appendChild(label);
      header.appendChild(status);
      wrapper.appendChild(header);
      wrapper.appendChild(canvasWrap);
      container.appendChild(wrapper);

      this.renderers.push({ channel, canvas, wrapper, funscript });
    }

    this.setVisible(this.visible);
    this.redraw();
  }

  /** Redraw all canvases immediately at the current playback position. */
  redraw(): void {
    const { currentTime, duration } = this.clock;
    this.renderAll(currentTime, duration);
  }

  onSeek(handler: (time: number) => void): void {
    this.seekHandler = handler;
  }

  isLocked(): boolean {
    return this.seekLocked;
  }

  setLocked(locked: boolean): void {
    this.seekLocked = locked;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container?.classList.toggle('viz-collapsed', !visible);
    for (const renderer of this.renderers) {
      renderer.canvas.style.pointerEvents = visible ? 'auto' : 'none';
    }
  }

  private startLoop(): void {
    if (this.rafHandle) return;
    const loop = (): void => {
      this.redraw();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (!this.rafHandle) return;
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    this.redraw();
  }

  private renderAll(currentTime: number, duration: number): void {
    for (const r of this.renderers) {
      this.renderScript(r, currentTime, duration);
    }
  }

  /** Resolve a Bootstrap CSS variable to a colour string usable on a canvas. */
  private bsVar(name: string, fallback: string): string {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return val || fallback;
  }

  private renderScript(
    r: ScriptRenderer,
    currentTime: number,
    duration: number,
  ): void {
    const { canvas, funscript } = r;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match canvas buffer width to CSS width.
    const cssWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 300;
    canvas.width = cssWidth;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (funscript.actions.length < 2 || duration <= 0) return;

    const zoom = Math.max(1, this.zoomLevel);

    // Determine the visible time window [startSec, endSec].
    const { startSec, endSec } = this.getVisibleWindow(currentTime, duration, zoom);

    const visibleMs = (endSec - startSec) * 1000;
    const startMs = startSec * 1000;

    // Graph line — Bootstrap secondary colour.
    const lineColor = this.bsVar('--bs-secondary', '#6c757d');
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;

    let first = true;
    for (const action of funscript.actions) {
      const relMs = action.at - startMs;
      if (relMs < 0 || relMs > visibleMs) {
        first = true; // gap — lift the pen for out-of-range segments
        continue;
      }
      const x = (relMs / visibleMs) * W;
      const y = H - (action.pos / 100) * H;

      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Playback cursor — Bootstrap primary colour.
    const cursorColor = this.bsVar('--bs-primary', '#0d6efd');
    const cursorX = ((currentTime - startSec) / (endSec - startSec)) * W;
    ctx.beginPath();
    ctx.strokeStyle = cursorColor;
    ctx.lineWidth = 2;
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, H);
    ctx.stroke();
  }

  private handleSeek(event: PointerEvent, canvas: HTMLCanvasElement): void {
    const { currentTime, duration } = this.clock;
    if (this.seekLocked || !this.seekHandler || duration <= 0) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const { startSec, endSec } = this.getVisibleWindow(
      currentTime,
      duration,
      Math.max(1, this.zoomLevel),
    );

    this.seekHandler(startSec + ((endSec - startSec) * ratio));
  }

  private getVisibleWindow(currentTime: number, duration: number, zoom: number): { startSec: number; endSec: number } {
    const windowSec = duration / zoom;
    const halfWindow = windowSec / 2;
    let startSec = currentTime - halfWindow;
    let endSec = currentTime + halfWindow;

    if (startSec < 0) {
      endSec = Math.min(duration, endSec - startSec);
      startSec = 0;
    }
    if (endSec > duration) {
      startSec = Math.max(0, startSec - (endSec - duration));
      endSec = duration;
    }

    return { startSec, endSec };
  }
}
