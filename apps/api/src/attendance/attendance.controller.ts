import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  attendanceMarkSchema,
  attendanceSettingsSchema,
  attendanceUploadSchema,
  type AttendanceMarkInput,
  type AttendanceSettingsInput,
  type AttendanceUploadInput,
  attendanceBulkMarkSchema,
  type AttendanceBulkMarkInput,
} from '@academy/shared';
import type { Response } from 'express';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AttendanceService } from './attendance.service';

/** An upload is a big body but a rare action; previews are repeated while matching rows by hand. */
const UPLOAD_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/** Sends the course's attendance CSV (admins and teaching speakers). */
export async function sendAttendanceCsv(res: Response, csv: Promise<string>): Promise<void> {
  const body = await csv;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(body);
}

/**
 * Admin → Course → Sessions → {session} → Attendance (ACADEMIC or SUPER). Speakers use the same
 * service under /speaker/courses/:courseId (TeachingController).
 */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('ACADEMIC')
@Controller('admin/courses')
export class AdminAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':id/attendance')
  @Header('Cache-Control', 'private, no-store')
  course(@Param('id') id: string) {
    return this.attendance.course(id);
  }

  @Put(':id/attendance/settings')
  settings(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(attendanceSettingsSchema)) body: AttendanceSettingsInput) {
    return this.attendance.updateSettings(id, body, user);
  }

  @Get(':id/attendance.csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    await sendAttendanceCsv(res, this.attendance.csv(id, user));
  }

  @Get(':id/sessions/:sessionId/attendance')
  @Header('Cache-Control', 'private, no-store')
  session(@Param('id') id: string, @Param('sessionId') sessionId: string) {
    return this.attendance.session(id, sessionId);
  }

  /** dryRun (default): the preview. dryRun false: replaces the session's attendance. */
  @Post(':id/sessions/:sessionId/attendance')
  @HttpCode(200)
  @Throttle(UPLOAD_LIMIT)
  upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('sessionId') sessionId: string, @Body(new ZodPipe(attendanceUploadSchema)) body: AttendanceUploadInput) {
    return this.attendance.upload(id, sessionId, body, user);
  }

  /** Many students at once ("select all → Present"). */
  @Post(':id/sessions/:sessionId/attendance/bulk')
  @HttpCode(200)
  @Throttle(UPLOAD_LIMIT)
  markMany(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('sessionId') sessionId: string, @Body(new ZodPipe(attendanceBulkMarkSchema)) body: AttendanceBulkMarkInput) {
    return this.attendance.markMany(id, sessionId, body.userIds, body.status, user);
  }

  @Put(':id/sessions/:sessionId/attendance/:userId')
  mark(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('sessionId') sessionId: string, @Param('userId') userId: string, @Body(new ZodPipe(attendanceMarkSchema)) body: AttendanceMarkInput) {
    return this.attendance.mark(id, sessionId, userId, body.status, user);
  }
}
