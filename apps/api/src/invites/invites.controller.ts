import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { inviteApplySchema, invitePreviewSchema, type InviteApplyInput, type InvitePreviewInput } from '@academy/shared';
import type { Response } from 'express';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { InvitesService } from './invites.service';

function sendCsv(res: Response, name: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv);
}

/** The course admin's "Enrol by email" tab. */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/courses/:id/invites')
export class AdminInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get()
  list(@Param('id') id: string) {
    return this.invites.list(id);
  }

  @Get('export.csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    sendCsv(res, 'course-invites', await this.invites.csv(id, user));
  }

  /** What enrolling these addresses would do. Changes nothing. */
  @Post('preview')
  @HttpCode(200)
  preview(@Param('id') id: string, @Body(new ZodPipe(invitePreviewSchema)) body: InvitePreviewInput) {
    return this.invites.preview(id, body);
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  apply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(inviteApplySchema)) body: InviteApplyInput) {
    return this.invites.apply(id, body, user);
  }

  @Post(':inviteId/resend')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  resend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('inviteId') inviteId: string) {
    return this.invites.resend(id, inviteId, user);
  }

  @Post(':inviteId/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('inviteId') inviteId: string) {
    return this.invites.revoke(id, inviteId, user);
  }
}
