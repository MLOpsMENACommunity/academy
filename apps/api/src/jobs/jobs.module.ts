import { EventReminderJobs } from './event-reminders.jobs';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { AccountJobs } from './account.jobs';
import { ReminderJobs } from './reminders.jobs';
import { RetentionJobs } from './retention.jobs';
import { JobsController } from './jobs.controller';

@Module({ imports: [UsersModule, PaymentsModule, AnnouncementsModule], controllers: [JobsController], providers: [AccountJobs, RetentionJobs, ReminderJobs, EventReminderJobs] })
export class JobsModule {}
