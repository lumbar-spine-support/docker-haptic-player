// Central error handler for Express 5. Maps errors to consistent { error } responses.

import type { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger';

const log = createLogger('[server-error]');

// HTTP errors explicitly thrown by route handlers.
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Express 5 error handler middleware (4 arguments required for error handling).
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    log.debug(`${err.status} ${err.message}`);
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Log unexpected errors, but don't leak details to client.
  log.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
