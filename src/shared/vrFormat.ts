export type VrLayout = 'sbs' | 'tb';

export interface VrFormat {
    fov: 180;
    layout: VrLayout;
}

/** Value of the `data-vr-format` attribute on `<video-player>`. */
export type VrFormatAttribute = `180-${VrLayout}`;

const SBS_TOKENS = new Set(['lr', 'sbs', '3dh']);
const TB_TOKENS = new Set(['tb', 'ou', '3dv']);

/** Detects VR180 videos from filename tokens such as `_180_LR`, `.180.TB` or `VR180`. */
export function parseVrFormat(filename: string): VrFormat | null {
    const tokens = filename.toLowerCase().replace(/\.[^.]+$/, '').split(/[_.\-\s]+/);
    const has180 = tokens.includes('180');
    if (has180 && tokens.some((t) => SBS_TOKENS.has(t))) return { fov: 180, layout: 'sbs' };
    if (has180 && tokens.some((t) => TB_TOKENS.has(t))) return { fov: 180, layout: 'tb' };
    if (tokens.includes('vr180')) return { fov: 180, layout: 'sbs' };
    return null;
}

export function vrFormatToAttribute(format: VrFormat): VrFormatAttribute {
    return `180-${format.layout}`;
}

export function vrFormatFromAttribute(value: string | null): VrFormat | null {
    if (value === '180-sbs') return { fov: 180, layout: 'sbs' };
    if (value === '180-tb') return { fov: 180, layout: 'tb' };
    return null;
}
