import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { eventInputSchema, toCsv, type EventInput, type PublicEventDto } from '@academy/shared';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

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
  get(@Param('slug') slug: string, @CurrentUser() user?: AuthUser): Promise<PublicEventDto> {
    return this.events.get(slug, user);
  }

  @Post(':slug/registration')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  register(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.events.register(user, slug);
  }

  @Delete(':slug/registration')
  unregister(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.events.unregister(user, slug);
  }

  @Public()
  @Get(':slug/calendar.ics')
  async ics(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const ics = await this.events.ics(slug, this.env.WEB_URL);
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

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(eventInputSchema)) body: EventInput) {
    const e = await this.events.save(toData(body));
    await this.audit.log({ actorId: user.id, action: 'event.created', entityType: 'LiveEvent', entityId: e.id });
    return e;
  }

  @Put(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(eventInputSchema)) body: EventInput) {
    const e = await this.events.save(toData(body), id);
    await this.audit.log({ actorId: user.id, action: 'event.updated', entityType: 'LiveEvent', entityId: id, metadata: { status: body.status } });
    return e;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.events.remove(id);
    await this.audit.log({ actorId: user.id, action: 'event.deleted', entityType: 'LiveEvent', entityId: id });
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
    res.send(
      toCsv(
        ['Name', 'Email', 'Country', 'Job title', 'Experience', 'Seniority', 'Registered at'],
        rows.map((r) => [r.name, r.email, r.country, r.jobTitle, r.experienceYears, r.seniority, r.registeredAt]),
      ),
    );
  }
}
