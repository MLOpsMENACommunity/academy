import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApplicationsModule } from './applications/applications.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { AppThrottlerGuard } from './common/throttler.guard';
import { ConfigModule } from './config/config.module';
import { CoursesModule } from './courses/courses.module';
import { EmailModule } from './email/email.module';
import { FunnelModule } from './funnel/funnel.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AuditModule,
    EmailModule,
    StorageModule,
    FunnelModule,
    NotificationsModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    ApplicationsModule,
    PaymentsModule,
    JobsModule,
  ],
  controllers: [HealthController],
  // Order matters: AuthGuard first (sets req.user), then the throttler keys by user or IP.
  // Default 300/min; auth, uploads and account changes set stricter limits.
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
