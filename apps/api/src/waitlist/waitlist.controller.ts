import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  courseInterestSchema,
  waitlistNotifySchema,
  waitlistTokenSchema,
  type CourseInterestInput,
  type WaitlistNotifyInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminCan, CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { WaitlistService } from './waitlist.service';

type TokenBody = z.infer<typeof waitlistTokenSchema>;

/** "Notify me when this course opens": public join and leave. */
@ApiTags('waitlist')
@Controller()
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  /** Signed in: no body needed (the account email is used). Signed out: { email }. */
  @Public()
  @Post('courses/:slug/interest')
  @HttpCode(200)
  // Per IP for visitors, per account when signed in (see AppThrottlerGuard).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  join(@Param('slug') slug: string, @Body(new ZodPipe(courseInterestSchema)) body: CourseInterestInput, @CurrentUser() user?: AuthUser) {
    return this.waitlist.join(slug, body, user);
  }

  @Delete('courses/:slug/interest')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async leave(@Param('slug') slug: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.waitlist.leaveAsUser(slug, user.id);
  }

  /** What a leave link is for. Doesn't change anything: mail scanners open links. */
  @Public()
  @Get('waitlist/leave')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  peek(@Query(new ZodPipe(waitlistTokenSchema)) q: TokenBody) {
    return this.waitlist.peek(q.token);
  }

  @Public()
  @Post('waitlist/leave')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  leaveByLink(@Body(new ZodPipe(waitlistTokenSchema)) body: TokenBody) {
    return this.waitlist.leaveByToken(body.token);
  }
}

function sendCsv(res: Response, name: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv);
}

/** The course admin's "Waiting list" tab. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('ADMISSIONS')
@Controller('admin/courses/:id/waitlist')
export class AdminWaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  list(@Param('id') id: string) {
    return this.waitlist.list(id);
  }

  @Get('export.csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    sendCsv(res, 'waiting-list', await this.waitlist.csv(id, user));
  }

  @Post('notify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  notify(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(waitlistNotifySchema)) body: WaitlistNotifyInput) {
    return this.waitlist.notify(id, body, user);
  }

  @Delete(':entryId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('entryId') entryId: string): Promise<void> {
    await this.waitlist.remove(id, entryId, user);
  }
}
