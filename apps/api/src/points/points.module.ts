import { Module } from '@nestjs/common';
import { AdminPointsController } from './admin-points.controller';
import { BadgesService } from './badges.service';
import { LeaderboardService } from './leaderboard.service';
import { PointsController } from './points.controller';
import { PointsJobs } from './points.jobs';
import { PointsService } from './points.service';

/**
 * Points, badges and course leaderboards. Depends only on global services (Prisma, settings,
 * audit, notifications, email), so assessments, learn and certificates can import it
 * without a cycle: they call PointsService (syncAssessment, syncSession, onCertificateIssued).
 */
@Module({
  controllers: [PointsController, AdminPointsController],
  providers: [PointsService, BadgesService, LeaderboardService, PointsJobs],
  exports: [PointsService, LeaderboardService, PointsJobs],
})
export class PointsModule {}
