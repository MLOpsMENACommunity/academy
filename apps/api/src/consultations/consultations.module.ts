import { Module } from '@nestjs/common';
import { AdminConsultationsController, ConsultationsController, SpeakerConsultationsController } from './consultations.controller';
import { ConsultationJobs } from './consultations.jobs';
import { ConsultationsService } from './consultations.service';

@Module({
  controllers: [ConsultationsController, SpeakerConsultationsController, AdminConsultationsController],
  providers: [ConsultationsService, ConsultationJobs],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
