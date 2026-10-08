import { Body, Controller, Get, Header, HttpCode, Inject, Param, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  feedbackSchema,
  progressSchema,
  reminderPreferenceSchema,
  type FeedbackInput,
  type LearnCourseDto,
  type NextSessionDto,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { LearnService } from './learn.service';

@ApiTags('learn')
@Controller()
export class LearnController {
  constructor(
    private readonly learn: LearnService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('me/next-sessions')
  next(@CurrentUser() user: AuthUser): Promise<NextSessionDto[]> {
    return this.learn.nextSessions(user.id);
  }

  @Get('learn/:slug')
  @Header('Cache-Control', 'private, no-store')
  course(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<LearnCourseDto> {
    return this.learn.course(user, slug);
  }

  @Put('learn/:slug/sessions/:sessionId/progress')
  @HttpCode(204)
  async progress(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodPipe(progressSchema)) body: z.infer<typeof progressSchema>,
  ): Promise<void> {
    await this.learn.setProgress(user, slug, sessionId, body.completed);
  }

  @Put('learn/:slug/feedback')
  @HttpCode(204)
  async feedback(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodPipe(feedbackSchema)) body: FeedbackInput,
  ): Promise<void> {
    await this.learn.setFeedback(user, slug, body);
  }

  @Put('learn/:slug/reminders')
  @HttpCode(204)
  async reminders(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodPipe(reminderPreferenceSchema)) body: z.infer<typeof reminderPreferenceSchema>,
  ): Promise<void> {
    await this.learn.setReminders(user, slug, body.emailReminders);
  }

  @Get('learn/:slug/calendar.ics')
  async courseIcs(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Res() res: Response): Promise<void> {
    this.sendIcs(res, await this.learn.ics(user, slug, this.env.WEB_URL));
  }

  @Get('learn/:slug/sessions/:sessionId/calendar.ics')
  async sessionIcs(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ): Promise<void> {
    this.sendIcs(res, await this.learn.ics(user, slug, this.env.WEB_URL, sessionId));
  }

  private sendIcs(res: Response, ics: { filename: string; body: string }): void {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ics.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(ics.body);
  }
}
