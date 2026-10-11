import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AdminSpeakerCoursesController, SpeakerAnnouncementsController } from './speaker-announcements.controller';
import { SpeakerAnnouncementsService } from './speaker-announcements.service';

@Module({
  imports: [AnnouncementsModule],
  controllers: [SpeakerAnnouncementsController, AdminSpeakerCoursesController],
  providers: [SpeakerAnnouncementsService],
})
export class SpeakerAnnouncementsModule {}
