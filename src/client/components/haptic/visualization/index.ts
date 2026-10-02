import { channelKey, channelLabel, type HapticChannel } from '../../../../shared/haptics';
import type { PreparedScript } from '../../../../shared/interpolation';
import type { LoadedScript } from '../../funscriptSync';
import { ROLE_ICON_CLASSES } from '../icons';
import type { PlaybackSession } from '../../player';
import { emptyStateHtml, scriptRowHtml } from './templates';
import { curvePoints, heatColor, MediaClock } from './geometry';

interface ScriptRenderer {
  channel: HapticChannel;
  canvas: HTMLCanvasElement;
  cursor: HTMLDivElement;
  /** Last applied cursor offset, so a fixed (zoomed) cursor isn't restyled every frame. */
  cursorX: number;
  wrapper: HTMLDivElement;
  prepared: PreparedScript;
  /** CSS pixel size; the backing buffer is this times devicePixelRatio. */
  width: number;
  height: number;
}

const CANVAS_HEIGHT = 60;

/**
 * Renders a line graph for each loaded Funscript on a canvas element.
 *
 * Supports horizontal zoom (zoom > 1 magnifies around the playhead) and
 * draws the cursor as a composited overlay element.
 */
export class Visualization {
  private renderers: ScriptRenderer[] = [];
  private container: HTMLElement | null = null;
  private readonly session: PlaybackSession;
  private rafHandle = 0;
  private seekHandler: ((time: number) => void) | null = null;
  private seekLocked = true;
  private visible = true;
  private readonly mediaClock = new MediaClock();
  private readonly resizeObserver = new ResizeObserver(() => this.resizeCanvases());
  private colors = { line: '#6c757d' };
  private colorGradient = false;

  /** Horizontal zoom factor (1 = full view, 2 = 2× zoom, etc.) */
  zoomLevel = 1;

  constructor(session: PlaybackSession) {
    this.session = session;
    session.onChange(() => {
      const { currentTime, paused } = this.clock;
      this.mediaClock.sync(currentTime, paused, this.playbackRate);
      if (paused) {
        this.stopLoop();
        this.redraw();
      } else {
        this.startLoop();
      }
    });
    new MutationObserver(() => {
      this.refreshColors();
      this.redraw();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme', 'class'] });
    this.refreshColors();
  }

  /** Timeline of the player shown on the file page, which may not be the playing one. */
  private get clock(): { currentTime: number; duration: number; paused: boolean } {
    return this.session.focusedStore.state;
  }

  private get playbackRate(): number {
    const rate = (this.clock as { playbackRate?: number }).playbackRate;
    return typeof rate === 'number' && rate > 0 ? rate : 1;
  }

  private get currentTime(): number {
    return this.mediaClock.read(this.clock.duration);
  }

  /**
   * Attach canvases to the container element and render the provided scripts.
   * Each script gets its own labelled canvas.
   */
  mount(
    container: HTMLElement,
    scripts: readonly LoadedScript[],
  ): void {
    container.innerHTML = '';
    this.resizeObserver.disconnect();
    this.renderers = [];
    this.container = container;

    if (scripts.length === 0) {
      container.innerHTML = emptyStateHtml();
      return;
    }

    for (const { channel, prepared } of scripts) {
      const template = document.createElement('template');
      template.innerHTML = scriptRowHtml({
        iconClass: ROLE_ICON_CLASSES[channel.type],
        label: channelLabel(channel),
        channelKey: channelKey(channel),
      }).trim();
      const wrapper = template.content.firstElementChild as HTMLDivElement;
      const canvas = wrapper.querySelector('canvas') as HTMLCanvasElement;
      const cursor = wrapper.querySelector('.viz-cursor') as HTMLDivElement;
      canvas.addEventListener('pointerdown', (event) => this.handleSeek(event, canvas));
      container.appendChild(wrapper);

      this.renderers.push({
        channel,
        canvas,
        cursor,
        cursorX: Number.NaN,
        wrapper,
        prepared,
        width: 0,
        height: 0,
      });
      this.resizeObserver.observe(canvas);
    }

    this.refreshColors();
    this.setVisible(this.visible);
    this.resizeCanvases();
  }

  /** Redraw all canvases immediately at the current playback position. */
  redraw(): void {
    this.renderAll(this.currentTime, this.clock.duration);
  }

  onSeek(handler: (time: number) => void): void {
    this.seekHandler = handler;
  }

  /** Colour the graph by movement speed instead of a single theme colour. */
  setColorGradient(enabled: boolean): void {
    this.colorGradient = enabled;
    this.redraw();
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

  private refreshColors(): void {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    this.colors = {
      line: read('--bs-secondary', '#6c757d'),
    };
  }

  private resizeCanvases(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const r of this.renderers) {
      const width = r.canvas.clientWidth || r.canvas.parentElement?.clientWidth || 300;
      const bufferWidth = Math.round(width * dpr);
      const bufferHeight = Math.round(CANVAS_HEIGHT * dpr);
      if (r.canvas.width !== bufferWidth || r.canvas.height !== bufferHeight) {
        r.canvas.width = bufferWidth;
        r.canvas.height = bufferHeight;
      }
      r.width = width;
      r.height = CANVAS_HEIGHT;
    }
    this.redraw();
  }

  private renderScript(
    r: ScriptRenderer,
    currentTime: number,
    duration: number,
  ): void {
    const { canvas, prepared, width: W, height: H } = r;
    const ctx = canvas.getContext('2d');
    if (!ctx || W <= 0) return;

    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);

    r.cursor.hidden = duration <= 0;
    if (duration <= 0) return;

    const { startSec, endSec } = this.getVisibleWindow(currentTime, duration, Math.max(1, this.zoomLevel));
    const startMs = startSec * 1000;
    const spanMs = (endSec - startSec) * 1000;
    // Keep the stroke inside the canvas at pos 0/100.
    const inset = 1;
    const snap = prepared.method !== 'pchip';
    const toX = (ms: number): number => ((ms - startMs) / spanMs) * W;
    const toY = (pos: number): number => {
      const y = inset + (1 - pos / 100) * (H - 2 * inset);
      return snap ? Math.round(y) + 0.5 : y;
    };

    const points = curvePoints(
      prepared,
      Math.max(0, startMs),
      Math.min(duration * 1000, startMs + spanMs),
      (spanMs / W) * 2,
    );
    if (points.length > 1) {
      ctx.lineWidth = this.colorGradient ? 1.5 : 1;
      ctx.lineJoin = 'round';
      let color = '';
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]!;
        const point = points[i]!;
        const next = this.colorGradient ? heatColor(point.speed) : this.colors.line;
        // Consecutive segments of the same colour share one path.
        if (next !== color) {
          if (color) ctx.stroke();
          color = next;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.moveTo(toX(prev.ms), toY(prev.pos));
        }
        ctx.lineTo(toX(point.ms), toY(point.pos));
      }
      ctx.stroke();
    }

    this.placeCursor(r, toX(currentTime * 1000));
  }

  private placeCursor(r: ScriptRenderer, x: number): void {
    if (x === r.cursorX) return;
    r.cursorX = x;
    r.cursor.style.transform = `translateX(${x}px)`;
  }

  private handleSeek(event: PointerEvent, canvas: HTMLCanvasElement): void {
    const { duration } = this.clock;
    const currentTime = this.currentTime;
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

    const target = startSec + ((endSec - startSec) * ratio);
    this.seekHandler(Math.max(0, Math.min(duration, target)));
  }

  /** Window centred on the playhead; at zoom 1 it shows the full track without scrolling. */
  private getVisibleWindow(currentTime: number, duration: number, zoom: number): { startSec: number; endSec: number } {
    if (zoom <= 1) return { startSec: 0, endSec: duration };
    const halfWindow = duration / zoom / 2;
    return { startSec: currentTime - halfWindow, endSec: currentTime + halfWindow };
  }
}
