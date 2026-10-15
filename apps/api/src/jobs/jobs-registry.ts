import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** A job the tick runs. It should only enqueue work (outbox rows) and return in seconds. */
export interface ScheduledJobRunner {
  run(now?: Date): Promise<number | Record<string, number>>;
}

/**
 * Marks a provider as a scheduled job; the value is the key its count is reported under
 * in the tick's response, e.g. @ScheduledJob('feedbackPromptsQueued'). The class must
 * implement ScheduledJobRunner. Adding a job is then one decorator in its own module:
 * jobs.controller.ts doesn't change.
 */
export const ScheduledJob = DiscoveryService.createDecorator<string>();

/**
 * Every @ScheduledJob provider in the app, found once at startup (a multi-provider:
 * jobs register themselves). The jobs tick runs them after the older, hand-listed jobs;
 * with JOBS_ENABLED (local, compose) an in-process cron runs them every 10 minutes.
 */
@Injectable()
export class JobsRegistry implements OnModuleInit {
  private readonly logger = new Logger(JobsRegistry.name);
  private jobs: { name: string; job: ScheduledJobRunner }[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    const found = this.discovery.getProviders({ metadataKey: ScheduledJob.KEY });
    const seen = new Set<string>();
    this.jobs = [];
    for (const wrapper of found) {
      const name = this.discovery.getMetadataByDecorator(ScheduledJob, wrapper);
      const job = wrapper.instance as ScheduledJobRunner | undefined;
      if (!name || !job || typeof job.run !== 'function') continue;
      if (seen.has(name)) throw new Error(`Two scheduled jobs are named "${name}"`);
      seen.add(name);
      this.jobs.push({ name, job });
    }
    this.jobs.sort((a, b) => a.name.localeCompare(b.name));
  }

  list(): readonly { name: string; job: ScheduledJobRunner }[] {
    return this.jobs;
  }

  /** Runs every registered job once; one failing doesn't stop the others. */
  async runAll(now = new Date()): Promise<Record<string, number | string>> {
    const results: Record<string, number | string> = {};
    for (const { name, job } of this.jobs) {
      try {
        const r = await job.run(now);
        if (typeof r === 'number') results[name] = r;
        else Object.assign(results, r);
      } catch (err) {
        results[`${name}Error`] = (err as Error).name;
        this.logger.error(`Job ${name} failed: ${(err as Error).name}`);
      }
    }
    return results;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cron(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    await this.runAll();
  }
}
