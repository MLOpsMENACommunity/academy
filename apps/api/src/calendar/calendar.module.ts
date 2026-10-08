import { Module } from '@nestjs/common';
import { CalendarFeedController } from './calendar-feed.controller';
import { CalendarFeedService } from './calendar-feed.service';

/** Private calendar subscription feeds (Google / Apple / Outlook Calendar). */
@Module({ controllers: [CalendarFeedController], providers: [CalendarFeedService], exports: [CalendarFeedService] })
export class CalendarModule {}
