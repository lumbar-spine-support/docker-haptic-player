import test from 'node:test';
import assert from 'node:assert/strict';

import { describeChannel } from '../../src/client/components/haptic/deviceStatus';

const TAG = '[client:deviceStatus]';

test(`${TAG} nothing assigned shows as disconnected`, () => {
    const view = describeChannel({ total: 0, usable: 0, alerts: [] });
    assert.equal(view.status, 'disconnected');
    assert.equal(view.label, 'Disconnected');
});

test(`${TAG} assigned but nothing usable is an error that lists the reasons once`, () => {
    const alert = { level: 'danger' as const, message: 'Device not connected to DG-Lab' };
    const view = describeChannel({ total: 2, usable: 0, alerts: [alert, alert] });
    assert.equal(view.status, 'error');
    assert.equal(view.label, 'No device');
    assert.equal(view.description.split('Device not connected to DG-Lab').length, 2);
});

test(`${TAG} a partial failure or a warning still plays, but asks for a check`, () => {
    const view = describeChannel({
        total: 2,
        usable: 1,
        alerts: [{ level: 'danger', message: 'Device not connected to DG-Lab' }],
    });
    assert.equal(view.status, 'warning');
    assert.match(view.description, /Device not connected to DG-Lab/);

    const muted = describeChannel({ total: 1, usable: 1, alerts: [{ level: 'warning', message: 'Channel A muted in DG-Lab' }] });
    assert.equal(muted.status, 'warning');
    assert.equal(muted.label, 'Check device');
});

test(`${TAG} usable outputs without alerts show as connected`, () => {
    const view = describeChannel({ total: 1, usable: 1, alerts: [] });
    assert.equal(view.status, 'connected');
    assert.equal(view.label, 'Connected');
});
