import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  awardBadgeSchema,
  badgeInputSchema,
  badgeUpdateSchema,
  leaderboardQuerySchema,
  manualPointsSchema,
  pointsEditSchema,
  pointsImportSchema,
  pointsVoidSchema,
  type AwardBadgeInput,
  type BadgeInput,
  type BadgeUpdate,
  type LeaderboardQuery,
  type ManualPointsInput,
  type PointsEditInput,
  type PointsImportInput,
  type PointsVoidInput,
} from '@academy/shared';
import type { Response } from 'express';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BadgesService } from './badges.service';
import { LeaderboardService } from './leaderboard.service';
import { PointsService } from './points.service';

/** Admin: manual points, the CSV import, badges, and the full course leaderboard. Everything that changes data is audited. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('ACADEMIC')
@Controller('admin')
export class AdminPointsController {
  constructor(
    private readonly points: PointsService,
    private readonly badges: BadgesService,
    private readonly boards: LeaderboardService,
  ) {}

  @Get('students/:id/points')
  student(@Param('id') id: string) {
    return this.points.adminStudent(id);
  }

  @Post('students/:id/points')
  award(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(manualPointsSchema)) body: ManualPointsInput) {
    return this.points.addManual(id, body, user);
  }

  /** Edits a manual entry: the old one is voided and replaced (same week). Automatic entries: 409 AUTOMATIC_ENTRY. */
  @Patch('points/:entryId')
  editPoints(@CurrentUser() user: AuthUser, @Param('entryId') entryId: string, @Body(new ZodPipe(pointsEditSchema)) body: PointsEditInput) {
    return this.points.editEntry(entryId, body, user, { kind: 'admin' });
  }

  /** Removes a manual entry: voided (kept, not counted), never deleted. */
  @Post('points/:entryId/void')
  @HttpCode(200)
  voidPoints(@CurrentUser() user: AuthUser, @Param('entryId') entryId: string, @Body(new ZodPipe(pointsVoidSchema)) body: PointsVoidInput) {
    return this.points.voidEntry(entryId, body, user, { kind: 'admin' });
  }

  @Post('students/:id/badges')
  awardBadge(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(awardBadgeSchema)) body: AwardBadgeInput) {
    return this.badges.award(id, body, user);
  }

  @Delete('badge-awards/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.badges.revoke(id, user);
  }

  @Post('points/import')
  @HttpCode(200)
  importCsv(@CurrentUser() user: AuthUser, @Body(new ZodPipe(pointsImportSchema)) body: PointsImportInput) {
    return this.points.importCsv(body.csv, body.dryRun, user, body.allowRepeat);
  }

  @Get('badges')
  list() {
    return this.badges.list();
  }

  @Post('badges')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(badgeInputSchema)) body: BadgeInput) {
    return this.badges.create(body, user);
  }

  @Patch('badges/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(badgeUpdateSchema)) body: BadgeUpdate) {
    return this.badges.update(id, body, user);
  }

  @Get('courses/:id/leaderboard')
  board(@Param('id') id: string, @Query(new ZodPipe(leaderboardQuerySchema)) q: LeaderboardQuery) {
    return this.boards.adminBoard(id, q);
  }

  @Get('courses/:id/leaderboard.csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query(new ZodPipe(leaderboardQuerySchema)) q: LeaderboardQuery, @Res() res: Response) {
    const csv = await this.boards.adminCsv(id, q, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leaderboard-${q.scope}${q.week ? `-week-${q.week}` : ''}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }
}
