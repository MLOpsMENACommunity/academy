import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { ApplicationsModule } from '../applications/applications.module';
import { CoursesModule } from '../courses/courses.module';
import { DriveModule } from '../drive/drive.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { AdminApplicationsService } from './admin-applications.service';
import { AdminCoursesService } from './admin-courses.service';
import { AdminController } from './admin.controller';
import { AdminMiscService } from './admin-misc.service';
import { AdminStudentsService } from './admin-students.service';
import { AdminTalentsService } from './admin-talents.service';

@Module({
  imports: [ApplicationsModule, PaymentsModule, AnnouncementsModule, CoursesModule, DriveModule],
  controllers: [AdminController],
  providers: [AdminApplicationsService, AdminStudentsService, AdminCoursesService, AdminMiscService, AdminAnnouncementsService, AdminTalentsService],
  // Course staff reuse them, scoped to their course (teaching/teach-manage.controller.ts).
  exports: [AdminApplicationsService, AdminCoursesService],
})
export class AdminModule {}
