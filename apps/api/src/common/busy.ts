import { HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * "Too busy right now, try again in a moment": a fast 503 with Retry-After instead of a
 * request that hangs and then fails with a 500. Used when the database pool, the password
 * hasher or the in-flight limit is exhausted, and when the database is unreachable.
 */
export const BUSY_MESSAGE = 'The academy is busy, please try again in a moment.';
export const DEFAULT_BUSY_RETRY_AFTER_S = 5;

export class BusyException extends ServiceUnavailableException {
  constructor(
    readonly reason: 'db_pool' | 'db_unreachable' | 'password_hash' | 'in_flight',
    readonly retryAfterS = DEFAULT_BUSY_RETRY_AFTER_S,
  ) {
    super({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'BUSY', message: BUSY_MESSAGE });
  }
}

/** Prisma error codes that mean "no database capacity right now", not a bug. */
const POOL_TIMEOUT = 'P2024'; // Timed out fetching a new connection from the connection pool
const UNREACHABLE = new Set(['P1001', 'P1002', 'P1008', 'P1017']); // can't reach / timed out / closed

/** The BusyException for a Prisma capacity or connectivity error, or null for anything else. */
export function busyFromPrisma(e: unknown): BusyException | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === POOL_TIMEOUT) return new BusyException('db_pool');
    if (UNREACHABLE.has(e.code)) return new BusyException('db_unreachable', 10);
    return null;
  }
  if (e instanceof Prisma.PrismaClientInitializationError) {
    return new BusyException('db_unreachable', 10);
  }
  return null;
}

/**
 * One log line per reason every 10 s at most: under overload there can be hundreds of these
 * a second, and logging each would cost the CPU we are short of.
 */
export class BusyLog {
  private counts = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly logger = new Logger('Capacity'),
    private readonly everyMs = 10_000,
  ) {}

  record(reason: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    this.timer ??= setTimeout(() => this.flush(), this.everyMs).unref();
  }

  flush(): void {
    this.timer = null;
    if (!this.counts.size) return;
    const entry = Object.fromEntries(this.counts);
    this.counts = new Map();
    this.logger.warn({ event: 'shed_load', status: 503, counts: entry });
  }
}

export const busyLog = new BusyLog();
