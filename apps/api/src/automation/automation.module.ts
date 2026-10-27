import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { CourseAccessModule } from '../course-access/course-access.module';
import { PointsModule } from '../points/points.module';
import { AdminAutomationController, TeachAutomationController } from './automation.controller';
import { AutomationJobs } from './automation.jobs';
import { AutomationService } from './automation.service';

@Module({
  imports: [CertificatesModule, PointsModule, CourseAccessModule],
  controllers: [AdminAutomationController, TeachAutomationController],
  providers: [AutomationService, AutomationJobs],
  exports: [AutomationService],
})
export class AutomationModule {}
