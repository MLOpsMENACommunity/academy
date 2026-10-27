import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { TELEGRAM_FETCH, TelegramApi } from './telegram-api';
import { AdminTelegramController, LearnTelegramController, MeTelegramController, TelegramWebhookController } from './telegram.controller';
import { TelegramService } from './telegram.service';

/** Hourly: lets in people whose join request waited for them to enrol or connect. */
@Injectable()
@ScheduledJob('telegramJoinRequestsApproved')
export class TelegramJobs implements ScheduledJobRunner, OnApplicationBootstrap {
  constructor(private readonly telegram: TelegramService) {}

  run(now = new Date()): Promise<number> {
    return this.telegram.sweep(now);
  }

  /** Points Telegram at the webhook on every start, in the background: never delays or fails the boot. */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.telegram.registerWebhook();
  }
}

@Module({
  controllers: [TelegramWebhookController, MeTelegramController, LearnTelegramController, AdminTelegramController],
  providers: [{ provide: TELEGRAM_FETCH, useValue: ((input, init) => fetch(input, init)) satisfies typeof fetch }, TelegramApi, TelegramService, TelegramJobs],
  exports: [TelegramService],
})
export class TelegramModule {}
