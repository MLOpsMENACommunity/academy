import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { speakerAnnouncementSchema, type SpeakerAnnouncementInput } from '@academy/shared';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SpeakerAnnouncementsService } from './speaker-announcements.service';

/** A speaker's announcements to their own live sessions, and the overview of their courses and sessions. Speaker accounts only. */
@ApiTags('speaker')
@Roles('SPEAKER')
@Controller('speaker')
export class SpeakerAnnouncementsController {
  constructor(private readonly service: SpeakerAnnouncementsService) {}

  /** Assigned courses, own sessions (with audience counts), sent messages and the limits. */
  @Get('announcements')
  overview(@CurrentUser() user: AuthUser) {
    return this.service.overview(user.id);
  }

  // POST speaker/courses/:courseId/announcements (to a course) is served by the Teaching routes
  // (teaching/teaching.controller.ts), for any course staff whose role has ANNOUNCE.

  @Post('sessions/:id/announcements')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  toSession(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(speakerAnnouncementSchema)) body: SpeakerAnnouncementInput) {
    return this.service.send(user, 'session', id, body);
  }
}

/** Admin → Speakers → {speaker} → Assigned courses. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('SPEAKERS')
@Controller('admin/instructors/:id/courses')
export class AdminSpeakerCoursesController {
  constructor(private readonly service: SpeakerAnnouncementsService) {}

  @Get()
  list(@Param('id') id: string) {
    return this.service.assignments(id);
  }

  @Put(':courseId')
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('courseId') courseId: string) {
    return this.service.assign(id, courseId, user.id);
  }

  @Delete(':courseId')
  @HttpCode(200)
  unassign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('courseId') courseId: string) {
    return this.service.unassign(id, courseId, user.id);
  }
}
