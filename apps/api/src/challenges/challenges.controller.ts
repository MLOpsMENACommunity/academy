import { Body, Controller, Get, Header, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  challengeEntrySchema,
  challengeVisibilitySchema,
  type ChallengeEntryInput,
  type ChallengeVisibilityInput,
  type MyChallengeDto,
  type PublicChallengeDto,
} from '@academy/shared';
import { CurrentUser, Public, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChallengesService } from './challenges.service';

const STUDENT_WRITE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Challenges for everyone and for students. The public list carries the names of finishers who
 * chose to be shown, so it is never cached (not in PUBLIC_CACHE_ROUTES, nor at the edge): a
 * student who hides their name, or deletes their account, disappears at once.
 */
@ApiTags('challenges')
@Controller()
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Get('challenges')
  @Public()
  @Header('Cache-Control', 'no-store')
  list(): Promise<PublicChallengeDto[]> {
    return this.challenges.listPublic();
  }

  @Get('challenges/:slug')
  @Public()
  @Header('Cache-Control', 'no-store')
  get(@Param('slug') slug: string): Promise<PublicChallengeDto> {
    return this.challenges.getPublic(slug);
  }

  @Get('me/challenges')
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: AuthUser): Promise<MyChallengeDto[]> {
    return this.challenges.listMine(user.id);
  }

  @Get('me/challenges/:slug')
  @Header('Cache-Control', 'private, no-store')
  myOne(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<MyChallengeDto> {
    return this.challenges.getMine(user.id, slug);
  }

  /** Submit or resubmit: 403 CHALLENGE_NOT_ELIGIBLE (course challenge), 409 CHALLENGE_NOT_STARTED / CHALLENGE_CLOSED / CHALLENGE_APPROVED. */
  @Put('me/challenges/:slug/entry')
  @Throttle(STUDENT_WRITE)
  submit(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body(new ZodPipe(challengeEntrySchema)) body: ChallengeEntryInput): Promise<MyChallengeDto> {
    return this.challenges.submit(user.id, slug, body);
  }

  @Put('me/challenges/:slug/visibility')
  @Throttle(STUDENT_WRITE)
  visibility(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body(new ZodPipe(challengeVisibilitySchema)) body: ChallengeVisibilityInput): Promise<MyChallengeDto> {
    return this.challenges.setVisibility(user.id, slug, body.showName);
  }
}
