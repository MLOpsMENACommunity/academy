import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AdminTeamModule } from './admin-team/admin-team.module';
import { ArchiveModule } from './archive/archive.module';
import { AssessmentsModule } from './assessments/assessments.module';
import { ApplicationsModule } from './applications/applications.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { ApiExceptionFilter } from './common/exception.filter';
import { PublicCache, PublicCacheInterceptor } from './common/public-cache';
import { CalendarModule } from './calendar/calendar.module';
import { CertificatesModule } from './certificates/certificates.module';
import { AppThrottlerGuard } from './common/throttler.guard';
import { ConfigModule } from './config/config.module';
import { CourseAccessModule } from './course-access/course-access.module';
import { CoursesModule } from './courses/courses.module';
import { EmailModule } from './email/email.module';
import { FunnelModule } from './funnel/funnel.module';
import { HealthController } from './health/health.controller';
import { InvitesModule } from './invites/invites.module';
import { JobsModule } from './jobs/jobs.module';
import { EventsModule } from './events/events.module';
import { LearnModule } from './learn/learn.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PointsModule } from './points/points.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { SpeakerAnnouncementsModule } from './speaker-announcements/speaker-announcements.module';
import { SpeakerPortalModule } from './speaker-portal/speaker-portal.module';
import { StorageModule } from './storage/storage.module';
import { TeachingModule } from './teaching/teaching.module';
import { UsersModule } from './users/users.module';
import { WaitlistModule } from './waitlist/waitlist.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AuditModule,
    CourseAccessModule,
    EmailModule,
    StorageModule,
    FunnelModule,
    NotificationsModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    CalendarModule,
    CoursesModule,
    WaitlistModule,
    ArchiveModule,
    ApplicationsModule,
    InvitesModule,
    PaymentsModule,
    LearnModule,
    AssessmentsModule,
    PointsModule,
    AttendanceModule,
    CertificatesModule,
    EventsModule,
    SpeakerPortalModule,
    SpeakerAnnouncementsModule,
    TeachingModule,
    AdminModule,
    AdminTeamModule,
    MediaModule,
    JobsModule,
  ],
  controllers: [HealthController],
  // Order matters: AuthGuard first (sets req.user), then the throttler keys by user or IP.
  // Default 300/min; auth, uploads and account changes set stricter limits.
  providers: [
    // Reports unexpected (non-HTTP) errors to Sentry when SENTRY_DSN is set (a no-op otherwise),
    // and answers framework errors (unknown route, throttling, bad JSON) with generic messages.
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    // Public catalog reads: edge-cacheable headers for anonymous visitors, a short in-process
    // cache, and invalidation on admin writes (common/public-cache.ts).
    PublicCache,
    { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
  ],
})
export class AppModule {}
