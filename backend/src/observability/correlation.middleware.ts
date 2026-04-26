import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Week 6.3 — Correlation id propagation.
 *
 * Reads the inbound `X-Request-Id` header (or generates a uuid v4) and:
 *   - attaches it to `req.correlationId` so handlers/loggers can log it.
 *   - mirrors it back via `X-Request-Id` so callers can correlate logs.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && incoming.trim()
        ? incoming.trim()
        : Array.isArray(incoming) && incoming[0]
          ? incoming[0]
          : randomUUID();
    req.correlationId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
