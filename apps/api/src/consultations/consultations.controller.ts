import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adminConsultantSchema,
  adminConsultationsQuerySchema,
  consultantSettingsSchema,
  consultationBookingSchema,
  consultationCancelSchema,
  consultationSlotsQuerySchema,
  type AdminConsultantInput,
  type ConsultantSettingsInput,
  type ConsultationBookingInput,
  type ConsultationCancelInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminCan, CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ConsultationsService } from './consultations.service';

/** The experts and their open slots (public), and the signed-in student's bookings. */
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

  /** Not edge-cached: open slots change with every booking. */
  @Public()
  @Get('experts/:slug/slots')
  @Header('Cache-Control', 'private, no-store')
  slots(@Param('slug') slug: string, @Query(new ZodPipe(consultationSlotsQuerySchema)) q: z.infer<typeof consultationSlotsQuerySchema>) {
    return this.consultations.slots(slug, q.duration);
  }

  @Post('experts/:slug/bookings')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  book(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body(new ZodPipe(consultationBookingSchema)) body: ConsultationBookingInput) {
    return this.consultations.book(user, slug, body);
  }

  @Get('bookings')
  mine(@CurrentUser() user: AuthUser) {
    return this.consultations.myBookings(user);
  }

  @Get('bookings/:id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.consultations.mine(user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(consultationCancelSchema)) body: ConsultationCancelInput) {
    return this.consultations.cancelMine(user, id, body.reason);
  }

  /** For the student or the expert of a confirmed call. */
  @Get('bookings/:id/calendar.ics')
  async ics(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const body = await this.consultations.ics(user, id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="consultation.ics"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  }
}

/** The expert's side, in the speaker portal: their hours, link and prices, and who booked. */
@ApiTags('speaker')
@Roles('SPEAKER')
@Controller('speaker/consultations')
export class SpeakerConsultationsController {
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

  @Post('bookings/:id/paid')
  @HttpCode(200)
  @AdminCan('FINANCE')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  paid(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.consultations.markPaid(user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @AdminCan('FINANCE')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(consultationCancelSchema)) body: ConsultationCancelInput) {
    return this.consultations.adminCancel(user, id, body.reason);
  }
}
