import { Module } from '@nestjs/common';
import { ConsultationsModule } from '../consultations/consultations.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuthModule } from '../auth/auth.module';
import { InvitesModule } from '../invites/invites.module';
import { SpeakerPortalModule } from '../speaker-portal/speaker-portal.module';
import { AccountService } from './account.service';
import { AdminAccountsController } from './admin-accounts.controller';
import { MeController } from './me.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule, SpeakerPortalModule, InvitesModule, ApplicationsModule, ConsultationsModule],
  controllers: [MeController, AdminAccountsController],
  providers: [ProfileService, AccountService],
  exports: [ProfileService, AccountService],
})
export class UsersModule {}
