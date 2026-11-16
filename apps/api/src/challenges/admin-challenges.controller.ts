import { Body, Controller, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChallengesService, type ChallengeScope } from './challenges.service';

const ADMIN: ChallengeScope = { kind: 'admin' };

/** Admin → Challenges: every challenge (open to all members or of one course) and its review queue. ACADEMIC, like points and badges. Audited. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('ACADEMIC')
@Controller('admin/challenges')
export class AdminChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list() {
    return this.challenges.list(ADMIN);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(challengeInputSchema)) body: ChallengeInput) {
    return this.challenges.create(body, ADMIN, user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@Param('id') id: string) {
    return this.challenges.get(id, ADMIN);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(challengeUpdateSchema)) body: ChallengeUpdate) {
    return this.challenges.update(id, body, ADMIN, user);
  }

  @Get(':id/entries')
  @Header('Cache-Control', 'private, no-store')
  entries(@Param('id') id: string, @Query(new ZodPipe(challengeEntriesQuerySchema)) q: ChallengeEntriesQuery) {
    return this.challenges.entries(id, ADMIN, q);
  }

  @Post(':id/entries/:entryId/review')
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('entryId') entryId: string, @Body(new ZodPipe(challengeReviewSchema)) body: ChallengeReviewInput) {
    return this.challenges.review(id, entryId, body, ADMIN, user);
  }
}
