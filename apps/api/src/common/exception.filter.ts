import { Catch, HttpException, HttpStatus, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import type { NextFunction, Request, Response } from 'express';
import { BusyException, busyFromPrisma, busyLog } from './busy';

/** Generic bodies for errors the framework would otherwise describe in its own words. */
export const PUBLIC_ERRORS = {
  notFound: 'Not found',
  tooManyRequests: 'Too many requests. Please wait a moment and try again.',
  invalidBody: 'Invalid request body',
  bodyTooLarge: 'Request body too large',
} as const;

/** Seconds to wait when a 429 doesn't already say (the throttler guard sets its own Retry-After). */
export const DEFAULT_RETRY_AFTER_S = 60;

/** An http-errors error from body-parser: malformed JSON, too large, bad charset… (has `type`, 4xx `status`). */
function isBodyParserError(e: unknown): e is { status: number; type: string } {
  if (!e || typeof e !== 'object') return false;
  const { status, type } = e as { status?: unknown; type?: unknown };
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Replaces framework-worded errors with generic ones, keeping the usual `{ statusCode, message }`
 * shape:
 *   - unknown routes ("Cannot GET /api/x")          -> 404 "Not found"
 *   - throttling ("ThrottlerException: Too Many…")  -> 429 "Too many requests…"
 *   - body-parser errors (raw JSON.parse messages)   -> 400 "Invalid request body" (413 for size)
 *   - no database capacity (Prisma P2024 pool timeout, database unreachable)
 *                                                    -> 503 code BUSY, with Retry-After
 * Every other error is returned unchanged: our own HttpExceptions (codes, field `errors`
 * from ZodPipe, messages the web shows) pass through as before, and unexpected errors
 * still become a bare 500 "Internal server error" (and reach Sentry).
 */
export function toPublicException(exception: unknown): unknown {
  // No database capacity (pool exhausted, database unreachable): a fast 503 with Retry-After,
  // not a 500 after Prisma's wait. Expected under overload, so not reported to Sentry.
  const busy = busyFromPrisma(exception);
  if (busy) return busy;
  if (exception instanceof ThrottlerException) {
    return new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: PUBLIC_ERRORS.tooManyRequests }, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (exception instanceof NotFoundException) {
    const body = exception.getResponse();
    const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
    // Nest's own wording for a route that doesn't exist.
    if (typeof message === 'string' && /^Cannot [A-Z]+ \//.test(message)) {
      return new NotFoundException({ statusCode: HttpStatus.NOT_FOUND, message: PUBLIC_ERRORS.notFound });
    }
    return exception;
  }
  if (!(exception instanceof HttpException) && isBodyParserError(exception)) {
    const tooLarge = exception.status === HttpStatus.PAYLOAD_TOO_LARGE;
    const status = tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;
    return new HttpException({ statusCode: status, message: tooLarge ? PUBLIC_ERRORS.bodyTooLarge : PUBLIC_ERRORS.invalidBody }, status);
  }
  return exception;
}

/**
 * Express error middleware, registered right after the JSON body parser (see setup.ts).
 * Nest would otherwise turn a parser SyntaxError into a 400 carrying JSON.parse's own message
 * before any filter sees it; this hands Nest the generic error instead.
 */
export function bodyParserErrors(err: unknown, _req: Request, _res: Response, next: NextFunction): void {
  next(isBodyParserError(err) ? toPublicException(err) : err);
}

/** Global filter: Sentry reporting (SentryGlobalFilter) plus generic error bodies (toPublicException). */
@Catch()
export class ApiExceptionFilter extends SentryGlobalFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const mapped = toPublicException(exception);
    if (host.getType() === 'http' && mapped instanceof HttpException) {
      const res = host.switchToHttp().getResponse<Response>();
      if (mapped instanceof BusyException) {
        busyLog.record(mapped.reason);
        // Never cached anywhere: the next try may well succeed.
        if (!res.headersSent) {
          res.setHeader('Retry-After', String(mapped.retryAfterS));
          res.setHeader('Cache-Control', 'no-store');
        }
      } else if (mapped.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        if (!res.headersSent && !res.getHeader('Retry-After')) res.setHeader('Retry-After', String(DEFAULT_RETRY_AFTER_S));
      }
    }
    super.catch(mapped, host);
  }
}
