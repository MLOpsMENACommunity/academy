import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  accountRoleSchema,
  slotBookingSchema,
  slotGeneratorSchema,
  slotInputSchema,
  speakerApplicationFilterSchema,
  speakerApplicationSchema,
  speakerReviewSchema,
  type SlotBookingInput,
  type SlotGeneratorInput,
  type SlotInput,
  type SpeakerApplicationFilter,
  type SpeakerApplicationInput,
  type SpeakerReviewInput,
} from '@academy/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SpeakerPortalService } from './speaker-portal.service';

/** The signed-in speaker's own portal. Speaker accounts only (students and admins get 403). */
@ApiTags('speaker')
@Roles('SPEAKER')
@Controller('speaker')
export class SpeakerPortalController {
  constructor(private readonly portal: SpeakerPortalService) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.portal.portal(user.id);
  }

  @Put('application')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  apply(@CurrentUser() user: AuthUser, @Body(new ZodPipe(speakerApplicationSchema)) body: SpeakerApplicationInput) {
    return this.portal.submitApplication(user.id, body);
  }

  @Get('slots')
  slots(@CurrentUser() user: AuthUser) {
    return this.portal.openSlots(user.id);
  }

  // Each booking emails the whole session team: keep the loop short.
  @Post('slots/:id/booking')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  book(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(slotBookingSchema)) body: SlotBookingInput) {
    return this.portal.book(user.id, id, body);
  }

  /** Title, abstract, kind and details, while the session is still a draft. */
  @Put('slots/:id/booking')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  updateBooking(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(slotBookingSchema)) body: SlotBookingInput) {
    return this.portal.updateBooking(id, body, { id: user.id, admin: false });
  }

  @Delete('slots/:id/booking')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.portal.cancel(user.id, id);
  }

  @Get('slots/:id/calendar.ics')
  async ics(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('locale') locale: string | undefined, @Res() res: Response): Promise<void> {
    const ics = await this.portal.ics(user.id, id, locale === 'ar' ? 'ar' : 'en');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ics.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(ics.body);
  }
}

const rangeSchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

/** Speaker applications, availability slots and account roles (admin panel → Speakers). */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminSpeakerPortalController {
  constructor(private readonly portal: SpeakerPortalService) {}

  @Get('speaker-applications')
  list(@Query(new ZodPipe(speakerApplicationFilterSchema)) f: SpeakerApplicationFilter) {
    return this.portal.adminList(f);
  }

  @Get('speaker-applications/:id')
  get(@Param('id') id: string) {
    return this.portal.adminGet(id);
  }

  @Put('speaker-applications/:id')
  updateApplication(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(speakerApplicationSchema)) body: SpeakerApplicationInput) {
    return this.portal.adminUpdateApplication(id, body, user.id);
  }

  @Post('speaker-applications/:id/review')
  @HttpCode(200)
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(speakerReviewSchema)) body: SpeakerReviewInput) {
    return this.portal.review(id, body, user.id);
  }

  @Put('users/:id/role')
  setRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(accountRoleSchema)) body: z.infer<typeof accountRoleSchema>) {
    return this.portal.setRole(id, body.role, user.id);
  }

  /** Default range: from the start of last month, a year ahead. */
  @Get('speaking-slots')
  slots(@Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    const now = new Date();
    const from = q.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = q.to ?? new Date(from.getTime() + 400 * 86_400_000);
    return this.portal.adminSlots(from, to);
  }

  @Post('speaking-slots')
  add(@CurrentUser() user: AuthUser, @Body(new ZodPipe(slotInputSchema)) body: SlotInput) {
    return this.portal.addSlot(body, user.id);
  }

  @Post('speaking-slots/generate')
  @HttpCode(200)
  generate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(slotGeneratorSchema)) body: SlotGeneratorInput) {
    return this.portal.generate(body, user.id);
  }

  /** The team edits a booking's title, abstract, kind and details (any time). */
  @Put('speaking-slots/:id/booking')
  updateBooking(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(slotBookingSchema)) body: SlotBookingInput) {
    return this.portal.updateBooking(id, body, { id: user.id, admin: true });
  }

  /** Frees a booked slot (the draft session is deleted; a published one is cancelled). */
  @Post('speaking-slots/:id/release')
  @HttpCode(204)
  async release(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.portal.adminRelease(id, user.id);
  }

  @Post('speaking-slots/:id/cancel')
  @HttpCode(204)
  async cancelSlot(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.portal.cancelSlot(id, user.id);
  }

  @Delete('speaking-slots/:id')
  @HttpCode(204)
  async deleteSlot(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.portal.deleteSlot(id, user.id);
  }
}
