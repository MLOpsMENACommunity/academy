import type { NextFunction, Request, Response } from 'express';
import { BUSY_MESSAGE, busyLog } from './busy';

/** Health checks are never refused: they must say the process is alive even when it is full. */
const EXEMPT = /^\/api\/health(\/live)?\/?$/;

/**
 * Load shedding: at most `max` requests in progress at once; beyond that, a fast 503 with
 * Retry-After. On a ¼ vCPU every request admitted past what the CPU and the database pool
 * can serve only waits longer and holds memory, and the Worker in front gives up anyway, so
 * refusing early keeps the latency of the admitted requests (and the process's memory) bounded.
 */
export function inFlightLimiter(max: number): ((req: Request, res: Response, next: NextFunction) => void) & { current: () => number } {
  let current = 0;
  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (max <= 0 || EXEMPT.test(req.path)) return next();
    if (current >= max) {
      busyLog.record('in_flight');
      res.status(503).set({ 'Retry-After': '2', 'Cache-Control': 'no-store' }).json({ statusCode: 503, code: 'BUSY', message: BUSY_MESSAGE });
      return;
    }
    current++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      current--;
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
  return Object.assign(middleware, { current: () => current });
}
