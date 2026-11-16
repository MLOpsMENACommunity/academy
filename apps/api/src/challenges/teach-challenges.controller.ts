import { Body, Controller, Get, Header, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  challengeEntriesQuerySchema,
  challengeInputSchema,
  challengeReviewSchema,
  challengeUpdateSchema,
  type ChallengeEntriesQuery,
  type ChallengeInput,
  type ChallengeReviewInput,
  type ChallengeUpdate,
} from '@academy/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CourseCan, CoursePermissionGuard } from '../course-access/course-permission.guard';
import { ChallengesService } from './challenges.service';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * Teaching → {course} → Challenges: that course's challenges. Creating and editing them is like
 * managing assessments (MANAGE_ASSESSMENTS); reviewing entries is like grading (GRADE). A
 * challenge or entry of another course is a 404. Audited with the staff member as the actor.
 */
@ApiTags('teach')
@UseGuards(CoursePermissionGuard)
@Controller('teach/courses')
export class TeachChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Get(':courseId/challenges')
  @CourseCan('MANAGE_ASSESSMENTS', 'GRADE')
  @Header('Cache-Control', 'private, no-store')
  list(@Param('courseId') courseId: string) {
    return this.challenges.list({ kind: 'course', courseId });
  }

  @Post(':courseId/challenges')
  @CourseCan('MANAGE_ASSESSMENTS')
  @Throttle(WRITE_LIMIT)
  create(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(challengeInputSchema)) body: ChallengeInput) {
    return this.challenges.create(body, { kind: 'course', courseId }, user);
  }

  @Put(':courseId/challenges/:id')
  @CourseCan('MANAGE_ASSESSMENTS')
  @Throttle(WRITE_LIMIT)
  update(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string, @Body(new ZodPipe(challengeUpdateSchema)) body: ChallengeUpdate) {
    return this.challenges.update(id, body, { kind: 'course', courseId }, user);
  }

  @Get(':courseId/challenges/:id/entries')
  @CourseCan('MANAGE_ASSESSMENTS', 'GRADE')
  @Header('Cache-Control', 'private, no-store')
  entries(@Param('courseId') courseId: string, @Param('id') id: string, @Query(new ZodPipe(challengeEntriesQuerySchema)) q: ChallengeEntriesQuery) {
    return this.challenges.entries(id, { kind: 'course', courseId }, q);
  }

  @Post(':courseId/challenges/:id/entries/:entryId/review')
  @CourseCan('GRADE')
  @Throttle(WRITE_LIMIT)
  review(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body(new ZodPipe(challengeReviewSchema)) body: ChallengeReviewInput,
  ) {
    return this.challenges.review(id, entryId, body, { kind: 'course', courseId }, user);
  }
}
