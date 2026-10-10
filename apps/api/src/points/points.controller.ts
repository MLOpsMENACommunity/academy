import { Body, Controller, Get, Header, Param, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  leaderboardOptInSchema,
  leaderboardQuerySchema,
  type LeaderboardDto,
  type LeaderboardQuery,
  type MyPointsDto,
  type PointsEntryDto,
} from '@academy/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { LeaderboardService } from './leaderboard.service';
import { PointsService } from './points.service';

/** Students: their points and badges, and the course leaderboards. */
@ApiTags('points')
@Controller()
export class PointsController {
  constructor(
    private readonly points: PointsService,
    private readonly boards: LeaderboardService,
  ) {}

  @Get('me/points')
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: AuthUser): Promise<MyPointsDto> {
    return this.points.mine(user.id);
  }

  @Get('me/points/history')
  @Header('Cache-Control', 'private, no-store')
  history(@CurrentUser() user: AuthUser): Promise<PointsEntryDto[]> {
    return this.points.history(user.id);
  }

  @Get('learn/:slug/leaderboard')
  @Header('Cache-Control', 'private, no-store')
  board(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Query(new ZodPipe(leaderboardQuerySchema)) q: LeaderboardQuery): Promise<LeaderboardDto> {
    return this.boards.board(user, slug, q);
  }

  @Put('learn/:slug/leaderboard/opt-in')
  optIn(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body(new ZodPipe(leaderboardOptInSchema)) body: z.infer<typeof leaderboardOptInSchema>): Promise<{ optedIn: boolean }> {
    return this.boards.setOptIn(user, slug, body.optedIn);
  }
}
