import test from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';

import { HttpError, errorMiddleware } from '../../../src/server/utils/errorHandler';

const TAG = '[server:utils:errorHandler]';

/** Minimal fake Express Response capturing the status/json calls made against it. */
function createFakeResponse() {
    const calls: { status?: number; body?: unknown } = {};
    const res = {
        status(code: number) {
            calls.status = code;
            return res;
        },
        json(body: unknown) {
            calls.body = body;
            return res;
        },
    };
    return { res: res as unknown as Response, calls };
}

test(`${TAG} HttpError carries status and message`, () => {
    const err = new HttpError(404, 'File not found');
    assert.equal(err.status, 404);
    assert.equal(err.message, 'File not found');
    assert.ok(err instanceof Error);
});

test(`${TAG} errorMiddleware maps HttpError to its status and { error } body`, () => {
    const { res, calls } = createFakeResponse();
    const err = new HttpError(400, 'Invalid request');
    errorMiddleware(err, {} as any, res, () => { });
    assert.equal(calls.status, 400);
    assert.deepEqual(calls.body, { error: 'Invalid request' });
});

test(`${TAG} errorMiddleware maps an unknown error to 500 with generic message`, () => {
    const { res, calls } = createFakeResponse();
    const err = new Error('Something went wrong');

    const originalConsoleError = console.error;
    console.error = () => { };
    try {
        errorMiddleware(err, {} as any, res, () => { });
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(calls.status, 500);
    assert.deepEqual(calls.body, { error: 'Internal server error' });
});
