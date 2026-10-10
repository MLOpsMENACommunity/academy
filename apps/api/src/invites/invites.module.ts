import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { AdminInvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [ApplicationsModule],
  controllers: [AdminInvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
