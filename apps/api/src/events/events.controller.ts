import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { eventInputSchema, toCsv, type EventInput, type PublicEventDto } from '@academy/shared';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Public()
  @SkipThrottle()
  @Get()
  list() {
    return this.events.list();
  }

  /** Public; includes the viewer's registration (and live link near the start) when signed in. */
  @Public()
  @SkipThrottle()
  @Get(':slug')
  get(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response, @CurrentUser() user?: AuthUser): Promise<PublicEventDto> {
    // Signed in, the response carries the viewer's registration and possibly the live link.
    if (user) res.setHeader('Cache-Control', 'private, no-store');
    return this.events.get(slug, user);
  }

  // Each first registration sends an email: keep the loop short.
  @Post(':slug/registration')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  register(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.events.register(user, slug);
  }

  @Delete(':slug/registration')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  unregister(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.events.unregister(user, slug);
  }

  @Public()
  @Get(':slug/calendar.ics')
  async ics(@Param('slug') slug: string, @Query('locale') locale: string | undefined, @Res() res: Response): Promise<void> {
    const ics = await this.events.ics(slug, locale === 'ar' ? 'ar' : 'en');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ics.filename}"`);
    res.send(ics.body);
  }
}

/** The signed-in person's upcoming registrations. */
@ApiTags('events')
@Controller('me')
export class MyEventsController {
  constructor(private readonly events: EventsService) {}

  @Get('events')
  mine(@CurrentUser() user: AuthUser): Promise<PublicEventDto[]> {
    return this.events.mine(user);
  }
}

const toData = (e: EventInput) => ({ ...e, capacity: e.capacity ?? null });

@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/events')
export class AdminEventsController {
  constructor(
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.events.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.events.adminGet(id);
  }

  /** Audited in the service, with what changed. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(eventInputSchema)) body: EventInput) {
    return this.events.save(toData(body), user.id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(eventInputSchema)) body: EventInput) {
    return this.events.save(toData(body), user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.events.remove(id, user.id);
  }

  @Get(':id/registrations')
  registrations(@Param('id') id: string) {
    return this.events.registrations(id);
  }

  @Get(':id/registrations.csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const rows = await this.events.registrations(id);
    await this.audit.log({ actorId: user.id, action: 'event.registrations_exported', entityType: 'LiveEvent', entityId: id, metadata: { count: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="session-registrations-${new Date().toISOString().slice(0, 10)}.csv"`);
    // Personal data: never kept by a browser or proxy cache.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(
      toCsv(
        ['Name', 'Email', 'Country', 'Job title', 'Experience', 'Seniority', 'Registered at'],
        rows.map((r) => [r.name, r.email, r.country, r.jobTitle, r.experienceYears, r.seniority, r.registeredAt]),
      ),
    );
  }
}
