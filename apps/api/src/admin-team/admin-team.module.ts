import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminTeamController } from './admin-team.controller';
import { AdminTeamService } from './admin-team.service';

@Module({
  imports: [UsersModule],
  controllers: [AdminTeamController],
  providers: [AdminTeamService],
})
export class AdminTeamModule {}
