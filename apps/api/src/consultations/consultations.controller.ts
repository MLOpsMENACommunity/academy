import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adminConsultantSchema,
  adminConsultationsQuerySchema,
  consultantSettingsSchema,
  consultationCancelSchema,
  consultationRejectSchema,
  consultationSlotsQuerySchema,
  consultationTimeSchema,
  type AdminConsultantInput,
  type ConsultantSettingsInput,
  type ConsultationCancelInput,
  type ConsultationRejectInput,
  type ConsultationTimeInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminCan, CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MAX_UPLOAD_BYTES } from '../storage/file-type';
import { ConsultationsService } from './consultations.service';

/** The experts and their open times (public), and the signed-in student's paid calls. */
@ApiTags('consultations')
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Public()
  @Get('experts')
  experts() {
    return this.consultations.consultants();
  }

  @Public()
  @Get('experts/:slug')
  expert(@Param('slug') slug: string) {
    return this.consultations.consultant(slug);
  }

  /** What a student sees before paying. Not edge-cached: open times change with every booking. */
  @Public()
  @Get('experts/:slug/slots')
  @Header('Cache-Control', 'private, no-store')
  slots(@Param('slug') slug: string, @Query(new ZodPipe(consultationSlotsQuerySchema)) q: z.infer<typeof consultationSlotsQuerySchema>) {
    return this.consultations.slots(slug, q.duration);
  }

  /** How to pay (the wallets set in Settings). */
  @Get('payment')
  payment() {
    return this.consultations.payment();
  }

  /** Pays for a call: the transfer screenshot (`screenshot`) and the form fields, for the academy to review. */
  @Post('experts/:slug/purchases')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('screenshot', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }))
  purchase(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() body: Record<string, unknown>, @UploadedFile() file?: Express.Multer.File) {
    return this.consultations.purchase(user, slug, body, file);
  }

  @Get('bookings')
  mine(@CurrentUser() user: AuthUser) {
    return this.consultations.myBookings(user);
  }

  @Get('bookings/:id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.consultations.mine(user, id);
  }

  /** The open times for one of my paid calls (to book, or to move it). */
  @Get('bookings/:id/slots')
  @Header('Cache-Control', 'private, no-store')
  bookingSlots(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.consultations.myOpenTimes(user, id);
  }

  /** Once the payment is approved: book one of the open times. */
  @Post('bookings/:id/book')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  book(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(consultationTimeSchema)) body: ConsultationTimeInput) {
    return this.consultations.book(user, id, body.startsAt);
  }

  /** Paid calls aren't refunded: a booked call may move, once, up to 24 hours before. */
  @Post('bookings/:id/reschedule')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reschedule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(consultationTimeSchema)) body: ConsultationTimeInput) {
    return this.consultations.reschedule(user, id, body.startsAt);
  }

  /** Google sends the expert back here after they allow calendar access (the URL is registered in Google Cloud). */
  @Get('google/callback')
  async googleCallback(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>, @Res() res: Response) {
    res.redirect(303, await this.consultations.googleCallback(user, q.code, q.state, q.error));
  }

  /** For the student or the expert of a booked call. */
  @Get('bookings/:id/calendar.ics')
  async ics(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const body = await this.consultations.ics(user, id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="consultation.ics"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  }
}

/**
 * The expert's own page: their bookings, hours, link and prices, and Google Calendar. Any signed-in
 * account whose speaker profile was set up for consultations (some experts are admins); others get 404.
 */
@ApiTags('consultations')
@Controller('consultations/expert')
export class ExpertConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.consultations.expertOverview(user.id);
  }

  @Put('settings')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  settings(@CurrentUser() user: AuthUser, @Body(new ZodPipe(consultantSettingsSchema)) body: ConsultantSettingsInput) {
    return this.consultations.updateExpertSettings(user.id, body);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(consultationCancelSchema)) body: ConsultationCancelInput) {
    return this.consultations.expertCancel(user.id, id, body.reason);
  }

  @Post('google/connect')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  googleConnect(@CurrentUser() user: AuthUser) {
    return this.consultations.googleConnectUrl(user.id);
  }

  @Delete('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  googleDisconnect(@CurrentUser() user: AuthUser) {
    return this.consultations.googleDisconnect(user.id);
  }
}

/** Admin → Consultations: who is listed (speakers team) and bookings and payments (finance). */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/consultations')
export class AdminConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Get('experts')
  @AdminCan('SPEAKERS')
  experts() {
    return this.consultations.adminConsultants();
  }

  @Put('experts/:instructorId')
  @AdminCan('SPEAKERS')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  upsert(@CurrentUser() user: AuthUser, @Param('instructorId') instructorId: string, @Body(new ZodPipe(adminConsultantSchema)) body: AdminConsultantInput) {
    return this.consultations.upsertConsultant(user, instructorId, body);
  }

  @Get('bookings')
  @AdminCan('FINANCE')
  bookings(@Query(new ZodPipe(adminConsultationsQuerySchema)) q: z.infer<typeof adminConsultationsQuerySchema>) {
    return this.consultations.adminBookings(q.status);
  }

  @Get('bookings/:id/screenshot')
  @AdminCan('FINANCE')
  screenshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.consultations.screenshotUrl(user, id);
  }

  @Post('bookings/:id/approve')
  @AdminCan('FINANCE')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.consultations.approve(user, id);
  }

  @Post('bookings/:id/reject')
  @AdminCan('FINANCE')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(consultationRejectSchema)) body: ConsultationRejectInput) {
    return this.consultations.reject(user, id, body.reason);
  }

  @Post('bookings/:id/cancel')
  @AdminCan('FINANCE')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(consultationCancelSchema)) body: ConsultationCancelInput) {
    return this.consultations.adminCancel(user, id, body.reason);
  }
}
