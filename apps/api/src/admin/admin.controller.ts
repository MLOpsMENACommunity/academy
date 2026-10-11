import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import {
  adminNoteSchema,
  applicationFilterSchema,
  bulkTransitionSchema,
  courseInputSchema,
  driveAccessSchema,
  instructorInputSchema,
  questionsInputSchema,
  SAVED_FILTER_SCOPES,
  savedFilterSchema,
  sessionInputSchema,
  announcementSchema,
  announcementAudienceSchema,
  type AnnouncementInput,
  sessionsBulkSchema,
  duplicateCourseSchema,
  sessionOrderSchema,
  studentFilterSchema,
  typedConfirmSchema,
  type ApplicationFilter,
  type CourseInput,
  type InstructorInput,
  type SessionInput,
  type StudentFilter,
} from '@academy/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { AdminApplicationsService } from './admin-applications.service';
import { AdminCoursesService } from './admin-courses.service';
import { AdminMiscService } from './admin-misc.service';
import { AdminStudentsService } from './admin-students.service';

const auditQuerySchema = z.object({
  action: z.string().max(80).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const scopeSchema = z.object({ scope: z.enum(SAVED_FILTER_SCOPES) });
const enrollmentQuerySchema = z.object({ driveAccess: z.enum(['pending', 'granted']).optional() });

function sendCsv(res: Response, name: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv);
}

/** Admin panel API. Every route is admin-only (student edits and deletion: users/admin-accounts.controller.ts). */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly applications: AdminApplicationsService,
    private readonly students: AdminStudentsService,
    private readonly courses: AdminCoursesService,
    private readonly misc: AdminMiscService,
    private readonly announcements: AdminAnnouncementsService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.misc.dashboard();
  }

  // ------------------------------------------------------------------ applications

  @Get('applications')
  listApplications(@Query(new ZodPipe(applicationFilterSchema)) f: ApplicationFilter) {
    return this.applications.list(f);
  }

  @Get('applications.csv')
  async exportApplications(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(applicationFilterSchema)) f: ApplicationFilter,
    @Res() res: Response,
  ) {
    sendCsv(res, 'applications', await this.applications.exportCsv(f, user));
  }

  @Get('applications/:id')
  application(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.applications.detail(id, user.id);
  }

  @Post('applications/bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bulkTransitionSchema)) body: z.infer<typeof bulkTransitionSchema>) {
    return this.applications.bulk(body.ids, body.event, user, body.reason);
  }

  @Post('applications/:id/notes')
  applicationNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adminNoteSchema)) body: { body: string }) {
    return this.applications.addNote(id, user, body.body);
  }

  // ------------------------------------------------------------------ students

  @Get('students')
  listStudents(@Query(new ZodPipe(studentFilterSchema)) f: StudentFilter) {
    return this.students.list(f);
  }

  @Get('students.csv')
  async exportStudents(@CurrentUser() user: AuthUser, @Query(new ZodPipe(studentFilterSchema)) f: StudentFilter, @Res() res: Response) {
    sendCsv(res, 'students', await this.students.exportCsv(f, user));
  }

  @Get('students/:id')
  student(@Param('id') id: string) {
    return this.students.detail(id);
  }

  @Get('students/:id/cv')
  @Header('Cache-Control', 'private, no-store')
  cv(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.students.cvUrl(id, user);
  }

  @Post('students/:id/notes')
  studentNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adminNoteSchema)) body: { body: string }) {
    return this.students.addNote(id, user, body.body);
  }

  // ------------------------------------------------------------------ courses

  @Get('courses')
  listCourses() {
    return this.courses.list();
  }

  @Post('courses')
  createCourse(@CurrentUser() user: AuthUser, @Body(new ZodPipe(courseInputSchema)) body: CourseInput) {
    return this.courses.create(body, user);
  }

  @Get('courses/:id')
  course(@Param('id') id: string) {
    return this.courses.get(id);
  }

  @Put('courses/:id')
  updateCourse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(courseInputSchema)) body: CourseInput) {
    return this.courses.update(id, body, user);
  }

  @Delete('courses/:id')
  @HttpCode(204)
  async deleteCourse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.courses.remove(id, user);
  }

  @Post('courses/:id/archive')
  @HttpCode(204)
  async archiveCourse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.courses.archive(id, user);
  }

  @Put('courses/:id/questions')
  questions(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(questionsInputSchema)) body: z.infer<typeof questionsInputSchema>) {
    return this.courses.setQuestions(id, body.questions, user);
  }

  @Post('courses/:id/sessions')
  createSession(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(sessionInputSchema)) body: SessionInput) {
    return this.courses.createSession(id, body, user);
  }

  @Post('courses/:id/sessions/bulk')
  createSessions(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(sessionsBulkSchema)) body: z.infer<typeof sessionsBulkSchema>) {
    return this.courses.createSessions(id, body.sessions, user);
  }

  @Post('courses/:id/duplicate')
  duplicate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(duplicateCourseSchema)) body: z.infer<typeof duplicateCourseSchema>) {
    return this.courses.duplicate(id, body, user);
  }

  @Put('courses/:id/sessions/order')
  reorder(@Param('id') id: string, @Body(new ZodPipe(sessionOrderSchema)) body: { ids: string[] }) {
    return this.courses.reorderSessions(id, body.ids);
  }

  @Put('courses/:id/sessions/:sessionId')
  updateSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodPipe(sessionInputSchema)) body: SessionInput,
  ) {
    return this.courses.updateSession(id, sessionId, body, user);
  }

  @Delete('courses/:id/sessions/:sessionId')
  @HttpCode(204)
  async deleteSession(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('sessionId') sessionId: string) {
    await this.courses.deleteSession(id, sessionId, user);
  }

  @Get('courses/:id/enrollments')
  enrollments(@Param('id') id: string, @Query(new ZodPipe(enrollmentQuerySchema)) q: z.infer<typeof enrollmentQuerySchema>) {
    return this.courses.enrollments(id, q.driveAccess);
  }

  @Get('courses/:id/enrollments.csv')
  async enrollmentsCsv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    sendCsv(res, 'enrolled-students', await this.courses.enrollmentsCsv(id, user));
  }

  @Put('enrollments/:id/drive-access')
  driveAccess(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(driveAccessSchema)) body: { granted: boolean }) {
    return this.courses.setDriveAccess(id, body.granted, user);
  }

  @Post('enrollments/:id/drive-removed')
  @HttpCode(204)
  async driveRemoved(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.courses.markDriveRemoved(id, user);
  }

  // ------------------------------------------------------------------ announcements

  @Get('courses/:id/announcements')
  announcementHistory(@Param('id') id: string) {
    return this.announcements.history(id);
  }

  @Get('courses/:id/announcements/audience')
  announcementAudience(@Param('id') id: string, @Query(new ZodPipe(announcementAudienceSchema)) q: z.infer<typeof announcementAudienceSchema>) {
    return this.announcements.audience(id, q.statuses);
  }

  @Post('courses/:id/announcements')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendAnnouncement(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(announcementSchema)) body: AnnouncementInput & { idempotencyKey: string }) {
    return this.announcements.send(id, body, user);
  }

  @Get('courses/:id/feedback')
  feedback(@Param('id') id: string) {
    return this.courses.feedback(id);
  }

  @Get('instructors')
  instructors() {
    return this.courses.instructors();
  }

  @Get('instructors/:id')
  instructor(@Param('id') id: string) {
    return this.courses.instructor(id);
  }

  @Post('instructors')
  createInstructor(@CurrentUser() user: AuthUser, @Body(new ZodPipe(instructorInputSchema)) body: InstructorInput) {
    return this.courses.saveInstructor(body, user);
  }

  @Put('instructors/:id')
  updateInstructor(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(instructorInputSchema)) body: InstructorInput) {
    return this.courses.saveInstructor(body, user, id);
  }

  /** Deletes the public profile (sessions stay, without the speaker link). Typed confirmation: the name. */
  @Post('instructors/:id/delete')
  @HttpCode(200)
  deleteInstructor(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(typedConfirmSchema)) body: z.infer<typeof typedConfirmSchema>) {
    return this.courses.deleteInstructor(id, body.confirm, user);
  }

  // ------------------------------------------------------------------ audit & saved views

  @Get('audit')
  audit(@Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    return this.misc.auditLog(q);
  }

  @Get('saved-filters')
  savedFilters(@CurrentUser() user: AuthUser, @Query(new ZodPipe(scopeSchema)) q: z.infer<typeof scopeSchema>) {
    return this.misc.savedFilters(user, q.scope);
  }

  @Post('saved-filters')
  saveFilter(@CurrentUser() user: AuthUser, @Body(new ZodPipe(savedFilterSchema)) body: z.infer<typeof savedFilterSchema>) {
    return this.misc.saveFilter(user, body);
  }

  @Delete('saved-filters/:id')
  @HttpCode(204)
  async deleteFilter(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.misc.deleteFilter(user, id);
  }
}
