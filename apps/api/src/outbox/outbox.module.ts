import { Global, Module } from '@nestjs/common';
import { EmailPreferenceLinks } from './email-links';
import { EmailPreferencesController } from './email-preferences.controller';
import { OutboxJobs } from './outbox.jobs';
import { OutboxProcessor } from './outbox.processor';
import { Outbox } from './outbox.service';

/** The durable email outbox, its tick job and the one-click unsubscribe links. Global: any module may enqueue. */
@Global()
@Module({
  controllers: [EmailPreferencesController],
  providers: [Outbox, OutboxProcessor, OutboxJobs, EmailPreferenceLinks],
  exports: [Outbox, OutboxProcessor, EmailPreferenceLinks],
})
export class OutboxModule {}
