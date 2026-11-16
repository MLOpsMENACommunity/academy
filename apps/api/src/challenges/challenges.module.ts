import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { AdminChallengesController } from './admin-challenges.controller';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { TeachChallengesController } from './teach-challenges.controller';

/** Cohort challenges: public list, students' entries, review by admins (ACADEMIC) and course staff (MANAGE_ASSESSMENTS / GRADE). */
@Module({
  imports: [PointsModule],
  controllers: [ChallengesController, AdminChallengesController, TeachChallengesController],
  providers: [ChallengesService],
})
export class ChallengesModule {}
