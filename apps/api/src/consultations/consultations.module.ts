import { Module } from '@nestjs/common';
import { AdminConsultationsController, ConsultationsController, ExpertConsultationsController } from './consultations.controller';
import { ConsultationJobs } from './consultations.jobs';
import { ConsultationsService } from './consultations.service';
import { GoogleCalendar } from './google-calendar';

@Module({
  controllers: [ConsultationsController, ExpertConsultationsController, AdminConsultationsController],
  providers: [ConsultationsService, ConsultationJobs, GoogleCalendar],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
