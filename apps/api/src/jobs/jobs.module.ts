import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AccountJobs } from './account.jobs';

@Module({ imports: [UsersModule], providers: [AccountJobs] })
export class JobsModule {}
