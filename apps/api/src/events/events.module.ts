import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AdminEventsController, EventsController, MyEventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [SettingsModule],
  controllers: [EventsController, MyEventsController, AdminEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
