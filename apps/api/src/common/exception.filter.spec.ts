import { BadRequestException, HttpException, Logger, NotFoundException, UnauthorizedException, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { BUSY_MESSAGE, busyLog } from './busy';
import { ApiExceptionFilter, DEFAULT_RETRY_AFTER_S, PUBLIC_ERRORS, toPublicException } from './exception.filter';

const body = (e: unknown) => (e as HttpException).getResponse();
const status = (e: unknown) => (e as HttpException).getStatus();

/** A body-parser error as express hands it over (http-errors). */
function parserError(status: number, type: string, message: string): Error {
  return Object.assign(new SyntaxError(message), { status, statusCode: status, type, expose: true, body: '{"a":' });
}

describe('toPublicException', () => {
  it('turns Nest’s unknown-route 404 into a generic one', () => {
    for (const m of ['Cannot GET /api', 'Cannot POST /api/nope', 'Cannot DELETE /api/x/y']) {
      const out = toPublicException(new NotFoundException(m));
      expect(status(out)).toBe(404);
      expect(body(out)).toEqual({ statusCode: 404, message: PUBLIC_ERRORS.notFound });
    }
  });

  it('keeps our own 404s as they are', () => {
    const own = new NotFoundException({ statusCode: 404, code: 'COURSE_NOT_FOUND', message: 'Course not found' });
    expect(toPublicException(own)).toBe(own);
    const plain = new NotFoundException();
    expect(toPublicException(plain)).toBe(plain);
  });

  it('words throttling for people, not as "ThrottlerException"', () => {
    const out = toPublicException(new ThrottlerException());
    expect(status(out)).toBe(429);
    expect(body(out)).toEqual({ statusCode: 429, message: PUBLIC_ERRORS.tooManyRequests });
    expect(JSON.stringify(body(out))).not.toMatch(/Throttler/);
  });

  it('hides raw JSON parser messages', () => {
    const bad = toPublicException(parserError(400, 'entity.parse.failed', 'Unexpected end of JSON input'));
    expect(status(bad)).toBe(400);
    expect(body(bad)).toEqual({ statusCode: 400, message: PUBLIC_ERRORS.invalidBody });
    const big = toPublicException(parserError(413, 'entity.too.large', 'request entity too large'));
    expect(status(big)).toBe(413);
    expect(body(big)).toEqual({ statusCode: 413, message: PUBLIC_ERRORS.bodyTooLarge });
  });

  it('leaves validation errors (fieldErrors), coded errors and unexpected errors untouched', () => {
    const zod = new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: 'email', message: 'Invalid email' }] });
    const coded = new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: "That email and password don't match" });
    const crash = new Error('db exploded');
    for (const e of [zod, coded, crash]) expect(toPublicException(e)).toBe(e);
  });
});

describe('ApiExceptionFilter', () => {
  function run(exception: unknown, headers: Record<string, string> = {}) {
    const reply = jest.fn();
    const res = {
      headersSent: false,
      getHeader: (k: string) => headers[k],
      setHeader: (k: string, v: string) => (headers[k] = v),
    };
    const adapter = { reply, isHeadersSent: () => false, end: jest.fn() };
    const host = { getType: () => 'http', switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }), getArgByIndex: () => res };
    new ApiExceptionFilter(adapter as never).catch(exception, host as unknown as ArgumentsHost);
    return { reply, headers };
  }

  it('answers 429 with a friendly body and a Retry-After', () => {
    const { reply, headers } = run(new ThrottlerException());
    expect(reply).toHaveBeenCalledWith(expect.anything(), { statusCode: 429, message: PUBLIC_ERRORS.tooManyRequests }, 429);
    expect(headers['Retry-After']).toBe(String(DEFAULT_RETRY_AFTER_S));
  });

  it('keeps the throttler’s own Retry-After', () => {
    const { headers } = run(new ThrottlerException(), { 'Retry-After': '17' });
    expect(headers['Retry-After']).toBe('17');
  });

  it('answers unexpected errors with a bare 500, no stack or message', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); // the stack is logged, not sent
    const { reply } = run(new Error('secret internals at /app/src/x.ts:12'));
    expect(reply).toHaveBeenCalledWith(expect.anything(), { statusCode: 500, message: 'Internal server error' }, 500);
  });

  const poolTimeout = () =>
    new Prisma.PrismaClientKnownRequestError('Timed out fetching a new connection from the connection pool.', { code: 'P2024', clientVersion: 'x' });

  it('answers an exhausted database pool with a fast 503 BUSY and Retry-After, never a 500', () => {
    const record = jest.spyOn(busyLog, 'record').mockImplementation(() => undefined);
    const { reply, headers } = run(poolTimeout());
    expect(reply).toHaveBeenCalledWith(expect.anything(), { statusCode: 503, code: 'BUSY', message: BUSY_MESSAGE }, 503);
    expect(headers['Retry-After']).toBe('5');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(record).toHaveBeenCalledWith('db_pool', expect.anything());
  });

  it('answers an unreachable database with 503 BUSY too', () => {
    jest.spyOn(busyLog, 'record').mockImplementation(() => undefined);
    const unreachable = new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: 'P1001', clientVersion: 'x' });
    const { reply, headers } = run(unreachable);
    expect(reply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ statusCode: 503, code: 'BUSY' }), 503);
    expect(headers['Retry-After']).toBe('10');
  });

  it('leaves other Prisma errors alone (a unique violation is a bug or a 409, not load)', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' });
    expect(toPublicException(unique)).toBe(unique);
  });
});
