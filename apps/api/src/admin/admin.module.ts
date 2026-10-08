import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { AdminApplicationsService } from './admin-applications.service';
import { AdminCoursesService } from './admin-courses.service';
import { AdminController } from './admin.controller';
import { AdminMiscService } from './admin-misc.service';
import { AdminStudentsService } from './admin-students.service';

@Module({
  imports: [ApplicationsModule, PaymentsModule],
  controllers: [AdminController],
  providers: [AdminApplicationsService, AdminStudentsService, AdminCoursesService, AdminMiscService, AdminAnnouncementsService],
})
export class AdminModule {}
