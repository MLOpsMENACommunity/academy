import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AdminWaitlistController, WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [AnnouncementsModule],
  controllers: [WaitlistController, AdminWaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
