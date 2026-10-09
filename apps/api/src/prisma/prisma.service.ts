import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { poolSettings, type PoolSettings } from './database-url';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly pool: Omit<PoolSettings, 'url'>;

  constructor(@Inject(ENV) env: Env) {
    // Explicit pool size and a short pool timeout (see database-url.ts): a request that can't
    // get a connection within DATABASE_POOL_TIMEOUT fails fast with a 503 (exception.filter.ts).
    const { url, ...pool } = poolSettings(env.DATABASE_URL, {
      poolSize: env.DATABASE_POOL_SIZE,
      poolTimeoutS: env.DATABASE_POOL_TIMEOUT,
      pgbouncer: env.DB_PGBOUNCER,
    });
    // 'minimal' keeps query arguments (emails, phones, answers) out of error messages,
    // which end up in logs and error tracking.
    super({ errorFormat: 'minimal', datasourceUrl: url });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Never the URL: only the pool settings.
    Logger.log(
      `Database pool: ${this.pool.connectionLimit} connections, ${this.pool.poolTimeoutS}s pool timeout${this.pool.pgbouncer ? ', pgbouncer mode' : ''}`,
      'Prisma',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
