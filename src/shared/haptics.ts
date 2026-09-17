import type { FunscriptType } from './types';

export const FUNSCRIPT_TYPES: readonly FunscriptType[] = ['stroker', 'buttplug', 'vibrator', 'estim', 'machine'];

/**
 * One scriptable output channel.
 *
 * A track may carry several scripts of the same type distinguished by a
 * subcategory, e.g. `song.estim.nipples.funscript` and `song.estim.butt.funscript`.
 */
export interface HapticChannel {
    type: FunscriptType;
    sub?: string;
}

const SUB_SEPARATOR = ':';

/** Stable identity of a channel, used as a map key, DOM data attribute and stored value. */
export function channelKey(channel: HapticChannel): string {
    return channel.sub ? `${channel.type}${SUB_SEPARATOR}${channel.sub}` : channel.type;
}

export function parseChannelKey(key: string): HapticChannel | null {
    const [type, ...rest] = key.split(SUB_SEPARATOR);
    if (!FUNSCRIPT_TYPES.includes(type as FunscriptType)) return null;
    const sub = rest.join(SUB_SEPARATOR);
    return sub ? { type: type as FunscriptType, sub } : { type: type as FunscriptType };
}

export const CHANNEL_TYPE_LABELS: Record<FunscriptType, string> = {
    stroker: 'Stroker',
    buttplug: 'Buttplug',
    vibrator: 'Vibrator',
    estim: 'E-Stim',
    machine: 'Machine',
};

/** Display names for commonly used subcategories, keyed by their lowercased filename token. */
export const CHANNEL_SUB_LABELS: Record<string, string> = {
    nipples: 'Nipples',
    butt: 'Butt',
    anal: 'Anal',
    clit: 'Clit',
    cock: 'Cock',
    balls: 'Balls',
    perineum: 'Perineum',
    prostate: 'Prostate',
    vagina: 'Vagina',
    left: 'Left',
    right: 'Right',
    inner: 'Inner',
    outer: 'Outer',
    thighs: 'Thighs',
    feet: 'Feet',
    neck: 'Neck',
    ears: 'Ears',
};

/** Display name of a subcategory; unknown ones fall back to capitalisation. */
export function subLabel(sub: string): string {
    return CHANNEL_SUB_LABELS[sub.toLowerCase()] ?? sub.charAt(0).toUpperCase() + sub.slice(1);
}

/** Human-readable channel name; subcategories are appended after an em dash. */
export function channelLabel(channel: HapticChannel): string {
    const base = CHANNEL_TYPE_LABELS[channel.type];
    return channel.sub ? `${base} — ${subLabel(channel.sub)}` : base;
}
