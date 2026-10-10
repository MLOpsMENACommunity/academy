import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpeakerPortalModule } from '../speaker-portal/speaker-portal.module';
import { AccountService } from './account.service';
import { MeController } from './me.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule, SpeakerPortalModule],
  controllers: [MeController],
  providers: [ProfileService, AccountService],
  exports: [ProfileService, AccountService],
})
export class UsersModule {}
