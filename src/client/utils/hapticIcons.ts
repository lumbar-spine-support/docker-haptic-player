import type { FunscriptType } from '../../shared/types';

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
