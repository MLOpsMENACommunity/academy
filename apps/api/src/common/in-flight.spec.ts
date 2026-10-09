import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { busyLog } from './busy';
import { inFlightLimiter } from './in-flight';

function fakeRes() {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(h: Record<string, string>) {
      Object.assign(res.headers, h);
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
  });
  return res;
}

const req = (path: string) => ({ path }) as Request;

describe('inFlightLimiter', () => {
  beforeEach(() => jest.spyOn(busyLog, 'record').mockImplementation(() => undefined));

  it('admits up to max, then answers a fast 503 BUSY with Retry-After', () => {
    const limit = inFlightLimiter(2);
    const next = jest.fn() as NextFunction;
    const a = fakeRes();
    const b = fakeRes();
    const c = fakeRes();
    limit(req('/api/courses'), a as unknown as Response, next);
    limit(req('/api/courses'), b as unknown as Response, next);
    limit(req('/api/courses'), c as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(c.statusCode).toBe(503);
    expect(c.headers['Retry-After']).toBe('2');
    expect(c.body).toMatchObject({ statusCode: 503, code: 'BUSY' });
    expect(limit.current()).toBe(2);

    // Finished (or aborted) requests free their slot exactly once.
    a.emit('finish');
    a.emit('close');
    expect(limit.current()).toBe(1);
    const d = fakeRes();
    limit(req('/api/courses'), d as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('never refuses health checks', () => {
    const limit = inFlightLimiter(1);
    const next = jest.fn() as NextFunction;
    limit(req('/api/courses'), fakeRes() as unknown as Response, next);
    limit(req('/api/health'), fakeRes() as unknown as Response, next);
    limit(req('/api/health/live'), fakeRes() as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('is off with max 0', () => {
    const limit = inFlightLimiter(0);
    const next = jest.fn() as NextFunction;
    for (let i = 0; i < 5; i++) limit(req('/api/x'), fakeRes() as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(5);
  });
});
