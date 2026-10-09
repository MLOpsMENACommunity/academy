import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * One structured line per request: method, route pattern (`/api/admin/students/:id`,
 * never the concrete URL or query string, which can carry emails or tokens),
 * status and duration. No IPs, user ids or bodies.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    // Health checks are noise.
    if (/\/health(\/live)?$/.test(route)) return;
    const entry = {
      requestId: id,
      method: req.method,
      route,
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
    };
    if (res.statusCode >= 500) logger.error(entry);
    else if (res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404) logger.warn(entry);
    else logger.log(entry);
  });
  next();
}
