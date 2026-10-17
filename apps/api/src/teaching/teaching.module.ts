import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { InvitesModule } from '../invites/invites.module';
import { PointsModule } from '../points/points.module';
import { SpeakerAnnouncementsModule } from '../speaker-announcements/speaker-announcements.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { TeachManageController } from './teach-manage.controller';
import { TeachManageService } from './teach-manage.service';
import { TeachingController } from './teaching.controller';
import { TeachingService } from './teaching.service';

/**
 * Course staff work on their courses: /teach/courses/:courseId/… (teaching routes also at the
 * older /speaker/courses/:courseId/…). Who may do what: CourseAccessService + CoursePermissionGuard.
 */
@Module({
  imports: [AssessmentsModule, AttendanceModule, PointsModule, AdminModule, ApplicationsModule, InvitesModule, WaitlistModule, CertificatesModule, SpeakerAnnouncementsModule],
  controllers: [TeachingController, TeachManageController],
  providers: [TeachingService, TeachManageService],
})
export class TeachingModule {}
