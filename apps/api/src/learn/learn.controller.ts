import { Body, Controller, Get, Header, HttpCode, Inject, Param, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  feedbackSchema,
  lessonCompletionSchema,
  lessonPositionSchema,
  type LessonPositionInput,
  reminderPreferenceSchema,
  type LessonCompletionInput,
  type FeedbackDueDto,
  type FeedbackInput,
  type LearnAnnouncementDto,
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

  /** The dashboard's "Rate your last session" card. */
  @Get('me/feedback-due')
  @Header('Cache-Control', 'private, no-store')
  feedbackDue(@CurrentUser() user: AuthUser): Promise<FeedbackDueDto[]> {
    return this.learn.feedbackDue(user.id);
  }

  @Get('learn/:slug')
  @Header('Cache-Control', 'private, no-store')
  course(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<LearnCourseDto> {
    return this.learn.course(user, slug);
  }

  /** The learn page's Announcements tab: all of the course's announcements this student may read. */
  @Get('learn/:slug/announcements')
  @Header('Cache-Control', 'private, no-store')
  announcements(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<LearnAnnouncementDto[]> {
    return this.learn.announcements(user, slug);
  }

  /** Retired (410): sessions are counted from attendance now. Kept so an old page gets a clear answer. */
  @Put('learn/:slug/sessions/:sessionId/progress')
  async progress(): Promise<void> {
    await this.learn.setProgress();
  }

  /** Self-paced courses: the video reached its end (WATCHED), or the student marked it (MANUAL). */
  @Put('learn/:slug/sessions/:sessionId/lesson-completion')
  @HttpCode(204)
  async lessonCompletion(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodPipe(lessonCompletionSchema)) body: LessonCompletionInput,
  ): Promise<void> {
    await this.learn.setLessonCompletion(user, slug, sessionId, body);
  }

  /**
   * Where the student stopped in the session's video. The player saves about every 15 s while it
   * plays, so the limit is generous; this write leaves the signed-in cache alone (signed-in-cache.ts).
   */
  @Put('learn/:slug/sessions/:sessionId/position')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async position(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodPipe(lessonPositionSchema)) body: LessonPositionInput,
  ): Promise<void> {
    await this.learn.setPosition(user, slug, sessionId, body);
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
