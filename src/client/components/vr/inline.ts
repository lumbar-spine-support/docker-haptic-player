import { applyDrag, clampView, DEFAULT_CAMERA, fromDeviceOrientation, perspective, rotation, wrapDegrees, type VrCameraState } from './camera';
import { DRAG_SURFACE_ATTR } from './dragGuard';
import { createVrProjection, type VrProjection } from './projection';
import type { VrFormat, VrView } from './types';

const MAX_DPR = 2;
const WHEEL_ZOOM = 0.0015;

type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Mono 360-style panorama of a VR180 video, navigated by mouse, touch, wheel/pinch and optional gyroscope. */
export class InlineVrView implements VrView {
    private camera: VrCameraState = { ...DEFAULT_CAMERA };
    private gyroOffset = { yaw: 0, pitch: 0 };
    private gyroBase: { yaw: number; pitch: number } | null = null;
    private gyroEnabled = false;

    private canvas: HTMLCanvasElement | null = null;
    private gl: WebGL2RenderingContext | null = null;
    private projection: VrProjection | null = null;
    private abort: AbortController | null = null;
    private gyroAbort: AbortController | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private previousOpacity = '';
    private rafHandle = 0;
    private vfcHandle = 0;
    private frameDirty = true;
    private readonly pointers = new Map<number, { x: number; y: number }>();

    constructor(
        private readonly container: HTMLElement,
        private readonly video: HTMLVideoElement,
        private readonly format: VrFormat,
    ) { }

    get gyro(): boolean {
        return this.gyroEnabled;
    }

    async start(): Promise<void> {
        if (this.canvas) return;
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
        if (!gl) throw new Error('VR: WebGL2 is not available');
        canvas.className = 'media-vr-canvas';
        canvas.setAttribute(DRAG_SURFACE_ATTR, '');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab;border-radius:inherit;';
        this.container.insertBefore(canvas, this.video.nextSibling);
        this.previousOpacity = this.video.style.opacity;
        this.video.style.opacity = '0';

        this.canvas = canvas;
        this.gl = gl;
        this.projection = createVrProjection(gl, this.format);
        this.abort = new AbortController();
        this.frameDirty = true;
        this.bindInput(canvas, this.abort.signal);
        this.bindVideo(this.abort.signal);
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
        this.resize();
        if (this.gyroEnabled) this.listenOrientation();
    }

    stop(): void {
        if (!this.canvas) return;
        this.abort?.abort();
        this.abort = null;
        this.gyroAbort?.abort();
        this.gyroAbort = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
        if (this.vfcHandle) this.video.cancelVideoFrameCallback?.(this.vfcHandle);
        this.vfcHandle = 0;
        this.projection?.dispose();
        this.projection = null;
        this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
        this.gl = null;
        this.canvas.remove();
        this.canvas = null;
        this.pointers.clear();
        this.video.style.opacity = this.previousOpacity;
    }

    /** Must be called from a user gesture: iOS asks for the motion-sensor permission here. */
    async setGyro(enabled: boolean): Promise<boolean> {
        if (enabled === this.gyroEnabled) return enabled;
        if (enabled) {
            const ctor = window.DeviceOrientationEvent as unknown as OrientationPermission | undefined;
            if (!ctor) return false;
            if (ctor.requestPermission && (await ctor.requestPermission().catch(() => 'denied')) !== 'granted') return false;
            this.gyroEnabled = true;
            this.gyroBase = null;
            if (this.canvas) this.listenOrientation();
        } else {
            this.gyroEnabled = false;
            // Keep the current view instead of snapping back when the sensor stops.
            this.camera = this.effectiveCamera();
            this.gyroOffset = { yaw: 0, pitch: 0 };
            this.gyroBase = null;
            this.gyroAbort?.abort();
            this.gyroAbort = null;
        }
        this.requestDraw();
        return this.gyroEnabled;
    }

    resetView(): void {
        this.camera = { ...DEFAULT_CAMERA };
        this.gyroBase = null;
        this.gyroOffset = { yaw: 0, pitch: 0 };
        this.requestDraw();
    }

    private get aspect(): number {
        const canvas = this.canvas;
        return canvas && canvas.height > 0 ? canvas.width / canvas.height : 16 / 9;
    }

    private effectiveCamera(): VrCameraState {
        return clampView({
            ...this.camera,
            yaw: this.camera.yaw + this.gyroOffset.yaw,
            pitch: this.camera.pitch + this.gyroOffset.pitch,
        }, this.aspect);
    }

    private setCamera(next: VrCameraState): void {
        // Clamp the drag part against the gyro offset, so dragging at the edge does not build up slack.
        const clamped = clampView({ ...next, yaw: next.yaw + this.gyroOffset.yaw, pitch: next.pitch + this.gyroOffset.pitch }, this.aspect);
        this.camera = { fovY: clamped.fovY, yaw: clamped.yaw - this.gyroOffset.yaw, pitch: clamped.pitch - this.gyroOffset.pitch };
        this.requestDraw();
    }

    private resize(): void {
        const canvas = this.canvas;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        this.setCamera(this.camera);
    }

    private requestDraw(): void {
        if (this.rafHandle || !this.canvas) return;
        this.rafHandle = requestAnimationFrame(() => {
            this.rafHandle = 0;
            this.render();
        });
    }

    private render(): void {
        const { canvas, projection } = this;
        if (!canvas || !projection) return;
        if (this.frameDirty) {
            projection.upload(this.video);
            this.frameDirty = false;
        }
        const cam = this.effectiveCamera();
        projection.draw(
            { x: 0, y: 0, width: canvas.width, height: canvas.height },
            perspective(cam.fovY, this.aspect),
            rotation(cam.yaw, cam.pitch),
            'left',
        );
    }

    private bindVideo(signal: AbortSignal): void {
        const video = this.video;
        const markFrame = () => {
            this.frameDirty = true;
            this.requestDraw();
        };
        if (typeof video.requestVideoFrameCallback === 'function') {
            const onFrame = () => {
                markFrame();
                this.vfcHandle = video.requestVideoFrameCallback(onFrame);
            };
            if (this.vfcHandle) video.cancelVideoFrameCallback(this.vfcHandle);
            this.vfcHandle = video.requestVideoFrameCallback(onFrame);
            signal.addEventListener('abort', () => {
                if (this.vfcHandle) video.cancelVideoFrameCallback(this.vfcHandle);
                this.vfcHandle = 0;
            });
        } else {
            const tick = () => {
                if (signal.aborted || video.paused) return;
                markFrame();
                requestAnimationFrame(tick);
            };
            video.addEventListener('play', tick, { signal });
            if (!video.paused) tick();
        }
        for (const type of ['loadeddata', 'seeked', 'emptied']) video.addEventListener(type, markFrame, { signal });
    }

    private bindInput(canvas: HTMLCanvasElement, signal: AbortSignal): void {
        const pinchDistance = () => {
            const [a, b] = [...this.pointers.values()];
            return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
        };
        const release = (event: PointerEvent) => {
            this.pointers.delete(event.pointerId);
            if (this.pointers.size === 0) canvas.style.cursor = 'grab';
        };

        canvas.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            canvas.setPointerCapture(event.pointerId);
            canvas.style.cursor = 'grabbing';
        }, { signal });

        canvas.addEventListener('pointermove', (event) => {
            const last = this.pointers.get(event.pointerId);
            if (!last) return;
            if (this.pointers.size >= 2) {
                const before = pinchDistance();
                last.x = event.clientX;
                last.y = event.clientY;
                const after = pinchDistance();
                if (before > 0 && after > 0) this.setCamera({ ...this.camera, fovY: this.camera.fovY * (before / after) });
                return;
            }
            const dx = event.clientX - last.x;
            const dy = event.clientY - last.y;
            last.x = event.clientX;
            last.y = event.clientY;
            this.setCamera(applyDrag(this.camera, dx, dy, canvas.clientHeight));
        }, { signal });

        // The drag guard may stop `pointerup` before it reaches the canvas; capture loss always follows it.
        canvas.addEventListener('lostpointercapture', release, { signal });
        canvas.addEventListener('pointercancel', release, { signal });

        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            this.setCamera({ ...this.camera, fovY: this.camera.fovY * Math.exp(event.deltaY * WHEEL_ZOOM) });
        }, { passive: false, signal });
    }

    private listenOrientation(): void {
        this.gyroAbort?.abort();
        this.gyroAbort = new AbortController();
        const { signal } = this.gyroAbort;
        this.gyroBase = null;
        window.addEventListener('deviceorientation', (event) => {
            if (event.alpha === null || event.beta === null || event.gamma === null) return;
            const current = fromDeviceOrientation(event.alpha, event.beta, event.gamma);
            if (!this.gyroBase) this.gyroBase = current;
            this.gyroOffset = {
                yaw: wrapDegrees(current.yaw - this.gyroBase.yaw),
                pitch: current.pitch - this.gyroBase.pitch,
            };
            this.requestDraw();
        }, { signal });
        // A rotated screen changes how the phone is held, so start again from the new pose.
        screen.orientation?.addEventListener('change', () => {
            this.camera = this.effectiveCamera();
            this.gyroBase = null;
            this.gyroOffset = { yaw: 0, pitch: 0 };
        }, { signal });
    }
}
