import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { SpeakerAccountsController } from './speaker-accounts.controller';
import { SpeakerAccountsService } from './speaker-accounts.service';

@Module({
  imports: [UsersModule],
  controllers: [SpeakerAccountsController],
  providers: [SpeakerAccountsService],
})
export class SpeakerAccountsModule {}
