/** Pure camera math for the VR180 views. Angles are in degrees, matrices column-major. */

export interface VrCameraState {
    yaw: number;
    pitch: number;
    fovY: number;
}

export const DEFAULT_CAMERA: Readonly<VrCameraState> = { yaw: 0, pitch: 0, fovY: 75 };
export const MIN_FOV_Y = 30;
export const MAX_FOV_Y = 100;

const RAD = Math.PI / 180;

export function perspective(fovYDeg: number, aspect: number, near = 0.1, far = 100): Float32Array {
    const f = 1 / Math.tan((fovYDeg * RAD) / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0,
    ]);
}

/** Camera orientation (camera → world): yaw about +Y (positive looks left), then pitch about +X (positive looks up). */
export function rotation(yawDeg: number, pitchDeg: number): Float32Array {
    const cy = Math.cos(yawDeg * RAD), sy = Math.sin(yawDeg * RAD);
    const cp = Math.cos(pitchDeg * RAD), sp = Math.sin(pitchDeg * RAD);
    // Ry(yaw) * Rx(pitch)
    return new Float32Array([
        cy, 0, -sy, 0,
        sy * sp, cp, cy * sp, 0,
        sy * cp, -sp, cy * cp, 0,
        0, 0, 0, 1,
    ]);
}

export function horizontalFov(fovYDeg: number, aspect: number): number {
    return (2 * Math.atan(Math.tan((fovYDeg * RAD) / 2) * aspect)) / RAD;
}

/** Content follows the pointer 1:1; dragging right looks left, dragging down looks up. */
export function applyDrag(state: VrCameraState, dxPx: number, dyPx: number, viewportHeightPx: number): VrCameraState {
    if (viewportHeightPx <= 0) return state;
    const perPx = state.fovY / viewportHeightPx;
    return { ...state, yaw: state.yaw + dxPx * perPx, pitch: state.pitch + dyPx * perPx };
}

/** Keeps the view inside the front hemisphere so the black back half never shows. */
export function clampView(state: VrCameraState, aspect: number): VrCameraState {
    const fovY = Math.min(MAX_FOV_Y, Math.max(MIN_FOV_Y, state.fovY));
    const maxYaw = Math.max(0, 90 - horizontalFov(fovY, aspect) / 2);
    return {
        fovY,
        yaw: Math.min(maxYaw, Math.max(-maxYaw, state.yaw)),
        pitch: Math.min(90, Math.max(-90, state.pitch)),
    };
}

/**
 * Yaw/pitch of the direction the back of the device faces, from `deviceorientation` angles.
 * Roll is ignored, so the screen orientation does not matter.
 */
export function fromDeviceOrientation(alpha: number, beta: number, gamma: number): { yaw: number; pitch: number } {
    const ca = Math.cos(alpha * RAD), sa = Math.sin(alpha * RAD);
    const cb = Math.cos(beta * RAD), sb = Math.sin(beta * RAD);
    const cg = Math.cos(gamma * RAD), sg = Math.sin(gamma * RAD);
    // Rz(alpha) * Rx(beta) * Ry(gamma) applied to (0, 0, -1), in east/north/up.
    const x = -sg;
    const y = sb * cg;
    const z = -cb * cg;
    const east = ca * x - sa * y;
    const north = sa * x + ca * y;
    const up = z;
    return {
        yaw: Math.atan2(-east, north) / RAD,
        pitch: Math.asin(Math.max(-1, Math.min(1, up))) / RAD,
    };
}

/** Wraps an angle difference into (-180, 180]. */
export function wrapDegrees(angle: number): number {
    const wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
    return wrapped === -180 ? 180 : wrapped;
}
