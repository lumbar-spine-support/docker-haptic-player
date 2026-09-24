import deviceCardTemplate from './templates/device-card.html';
import deviceFeatureTemplate from './templates/device-feature.html';
import deviceDetailTemplate from './templates/device-detail.html';
import deviceAlertTemplate from './templates/device-alert.html';
import deviceBadgeTemplate from './templates/device-badge.html';
import { renderTemplate } from '../../utils/template';
import type { DeviceAlert, DeviceBadge, FeatureDetail } from './backend';

export function deviceCardHtml(values: { name: string; badge: string; alerts: string }): string {
    return renderTemplate(deviceCardTemplate, values);
}

export function deviceFeatureHtml(values: {
    detailsId: string;
    iconClass: string;
    label: string;
    ariaLabel: string;
    details: string;
    expanded: string;
    collapseClass: string;
}): string {
    return renderTemplate(deviceFeatureTemplate, values);
}

export function deviceDetailHtml(detail: FeatureDetail): string {
    return renderTemplate(deviceDetailTemplate, {
        label: detail.label,
        value: detail.value,
        valueClass: detail.warn ? 'text-warning' : 'text-light',
    });
}

export function deviceAlertHtml(alert: DeviceAlert): string {
    return renderTemplate(deviceAlertTemplate, { level: alert.level, message: alert.message });
}

export function deviceBadgeHtml(badge: DeviceBadge): string {
    return renderTemplate(deviceBadgeTemplate, {
        icon: badge.icon,
        color: badge.color ?? 'inherit',
        title: badge.title ?? '',
    });
}
