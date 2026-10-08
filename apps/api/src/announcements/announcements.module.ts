import { Module } from '@nestjs/common';
import { AnnouncementDelivery } from './announcement-delivery.service';

@Module({ providers: [AnnouncementDelivery], exports: [AnnouncementDelivery] })
export class AnnouncementsModule {}
