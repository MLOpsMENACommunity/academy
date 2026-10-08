import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AccountJobs } from './account.jobs';
import { JobsController } from './jobs.controller';

@Module({ imports: [UsersModule], controllers: [JobsController], providers: [AccountJobs] })
export class JobsModule {}
