import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** DATABASE_URL with the pool settings from the environment, unless the URL sets its own. */
export function pooledDatabaseUrl(env: Pick<Env, 'DATABASE_URL' | 'DATABASE_POOL_SIZE' | 'DATABASE_POOL_TIMEOUT'>): string {
  const url = new URL(env.DATABASE_URL);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', String(env.DATABASE_POOL_SIZE));
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', String(env.DATABASE_POOL_TIMEOUT));
  return url.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    // 'minimal' keeps query arguments (emails, phones, answers) out of error messages,
    // which end up in logs and error tracking.
    super({ errorFormat: 'minimal', datasourceUrl: pooledDatabaseUrl(env) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
