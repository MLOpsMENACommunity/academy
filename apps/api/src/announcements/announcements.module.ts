import { Module } from '@nestjs/common';
import { AnnouncementDelivery } from './announcement-delivery.service';
import { WaitlistLinks } from './waitlist-links';

@Module({ providers: [AnnouncementDelivery, WaitlistLinks], exports: [AnnouncementDelivery, WaitlistLinks] })
export class AnnouncementsModule {}
