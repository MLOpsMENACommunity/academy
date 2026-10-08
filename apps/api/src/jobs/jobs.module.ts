import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { AccountJobs } from './account.jobs';
import { RetentionJobs } from './retention.jobs';
import { JobsController } from './jobs.controller';

@Module({ imports: [UsersModule, PaymentsModule], controllers: [JobsController], providers: [AccountJobs, RetentionJobs] })
export class JobsModule {}
