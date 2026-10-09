import { Controller, Get, Header, Inject, Res, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** How long one database check answers every /api/health call. */
export const READY_CACHE_MS = 5_000;
/** A database check slower than this counts as failed (the pool may be saturated). */
export const DB_CHECK_TIMEOUT_MS = 2_000;

/**
 * Two checks:
 *   GET /api/health/live  liveness: the process answers. No database, so it stays fast and
 *                         truthful while the pool is saturated (Docker HEALTHCHECK uses it).
 *   GET /api/health       readiness: also checks the database, at most once per
 *                         READY_CACHE_MS however many callers there are (deploy smoke test,
 *                         uptime monitors, load tests), and never waits longer than
 *                         DB_CHECK_TIMEOUT_MS for it.
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  private last: { at: number; ok: boolean } | null = null;
  private pending: Promise<boolean> | null = null;
  private readonly started = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'The API process is up (no database check)' })
  live(): { status: 'ok'; uptimeS: number; release?: string } {
    return { status: 'ok', uptimeS: Math.round((Date.now() - this.started) / 1000), release: this.env.ACADEMY_RELEASE };
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'API and database are reachable' })
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok'; db: 'ok'; time: string; release?: string }> {
    if (!(await this.dbOk())) {
      res.setHeader('Retry-After', '5');
      throw new ServiceUnavailableException({ status: 'error', db: 'unreachable' });
    }
    return { status: 'ok', db: 'ok', time: new Date().toISOString(), release: this.env.ACADEMY_RELEASE };
  }

  private dbOk(): Promise<boolean> {
    if (this.last && Date.now() - this.last.at < READY_CACHE_MS) return Promise.resolve(this.last.ok);
    this.pending ??= withTimeout(this.prisma.$queryRaw`SELECT 1`, DB_CHECK_TIMEOUT_MS)
      .then(
        () => true,
        () => false,
      )
      .then((ok) => {
        this.last = { at: Date.now(), ok };
        this.pending = null;
        return ok;
      });
    return this.pending;
  }
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
