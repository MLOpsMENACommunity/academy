import { EventReminderJobs } from './event-reminders.jobs';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { InvitesModule } from '../invites/invites.module';
import { PointsModule } from '../points/points.module';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { AccountJobs } from './account.jobs';
import { ReminderJobs } from './reminders.jobs';
import { RetentionJobs } from './retention.jobs';
import { JobsController } from './jobs.controller';
import { JobsRegistry } from './jobs-registry';

@Module({ imports: [DiscoveryModule, UsersModule, PaymentsModule, AnnouncementsModule, AssessmentsModule, PointsModule, InvitesModule], controllers: [JobsController], providers: [AccountJobs, RetentionJobs, ReminderJobs, EventReminderJobs, JobsRegistry] })
export class JobsModule {}
