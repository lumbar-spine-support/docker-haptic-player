import { OutputType } from 'buttplug';
import type { FunscriptType } from '../../../shared/types';

/** Bootstrap icons for Buttplug outputs that differ from their feature kind's default icon. */
export const OUTPUT_ICONS: Partial<Record<OutputType, string>> = {
    [OutputType.Oscillate]: 'bi-water',
    [OutputType.Constrict]: 'bi-arrows-angle-contract',
    [OutputType.Inflate]: 'bi-arrows-angle-expand',
    [OutputType.Temperature]: 'bi-thermometer-half',
    [OutputType.Led]: 'bi-lightbulb-fill',
    [OutputType.Spray]: 'bi-droplet-fill',
};

export const ROLE_ICON_CLASSES: Record<FunscriptType, string> = {
    stroker: 'device-role-icon-stroker',
    buttplug: 'device-role-icon-buttplug',
    vibrator: 'device-role-icon-vibrator',
    estim: 'device-role-icon-estim',
    machine: 'device-role-icon-machine',
    unknown: 'device-role-icon-generic bi bi-patch-question-fill',
};

export const ROLE_LABELS: Record<FunscriptType, string> = {
    stroker: 'Stroker',
    buttplug: 'Buttplug',
    vibrator: 'Vibrator',
    estim: 'E-stim',
    machine: 'Machine',
    unknown: 'Generic',
};

export function renderHapticIcons(types: FunscriptType[]): string {
    return Array.from(new Set(types))
        .map((type) => `<span class="device-role-icon ${ROLE_ICON_CLASSES[type]}" title="${ROLE_LABELS[type]}"></span>`)
        .join('');
}
