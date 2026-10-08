import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
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
import { EventsModule } from './events/events.module';
import { LearnModule } from './learn/learn.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    SentryModule.forRoot(),
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
    LearnModule,
    EventsModule,
    AdminModule,
    JobsModule,
  ],
  controllers: [HealthController],
  // Order matters: AuthGuard first (sets req.user), then the throttler keys by user or IP.
  // Default 300/min; auth, uploads and account changes set stricter limits.
  providers: [
    // Reports unexpected (non-HTTP) errors to Sentry when SENTRY_DSN is set; a no-op otherwise.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
