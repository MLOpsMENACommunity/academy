import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AdminSpeakerPortalController, SpeakerPortalController } from './speaker-portal.controller';
import { SpeakerPortalService } from './speaker-portal.service';

@Module({
  imports: [EventsModule],
  controllers: [SpeakerPortalController, AdminSpeakerPortalController],
  providers: [SpeakerPortalService],
  exports: [SpeakerPortalService],
})
export class SpeakerPortalModule {}
