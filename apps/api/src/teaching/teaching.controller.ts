import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  attendanceMarkSchema,
  attendanceUploadSchema,
  pointsEditSchema,
  pointsVoidSchema,
  assessmentInputSchema,
  assessmentOrderSchema,
  gradeInputSchema,
  sessionMaterialsSchema,
  speakerAnnouncementSchema,
  submissionFilterSchema,
  teachingPointsSchema,
  type AttendanceMarkInput,
  type AttendanceUploadInput,
  type PointsEditInput,
  type PointsVoidInput,
  type AssessmentInput,
  type AssessmentOrderInput,
  type GradeInput,
  type SessionMaterialsInput,
  type SpeakerAnnouncementInput,
  type TeachingPointsInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminAssessmentsService } from '../assessments/admin-assessments.service';
import { sendAttendanceCsv } from '../attendance/attendance.controller';
import { AttendanceService } from '../attendance/attendance.service';
import { PointsService } from '../points/points.service';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ANY_STAFF, CourseCan, CoursePermissionGuard, type CourseRequest } from '../course-access/course-permission.guard';
import { SpeakerAnnouncementsService } from '../speaker-announcements/speaker-announcements.service';
import { TeachingService } from './teaching.service';

/** Changes: generous for someone at work, small enough to stop a runaway script. */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
/** Grading a whole class goes quickly, one save per student. */
const GRADE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/**
 * Teaching → {course}: course staff work on their courses, each route behind one or more course
 * permissions (@CourseCan, checked by CoursePermissionGuard against the database on every
 * request: 403 NOT_YOUR_COURSE off the staff or for an unknown course, 403 COURSE_PERMISSION
 * without the permission). Any account role (a student moderator too); SUPER and ACADEMIC admins
 * everywhere. Each handler checks that the assessment, submission, session, student or entry id
 * is one of that course's (404 otherwise). Writes reuse the admin services, so they are audited
 * with the staff member as the actor and tell students the same way.
 *
 * Served at /teach/courses/… and, for the speaker portal and older links, /speaker/courses/….
 * The course-management routes (details, sessions, applications, enrolment, certificates,
 * roster) are in teach-manage.controller.ts, under /teach/courses only.
 */
@ApiTags('teach')
@UseGuards(CoursePermissionGuard)
@Controller(['teach/courses', 'speaker/courses'])
export class TeachingController {
  constructor(
    private readonly teaching: TeachingService,
    private readonly assessments: AdminAssessmentsService,
    private readonly attendance: AttendanceService,
    private readonly ledger: PointsService,
    private readonly announcements: SpeakerAnnouncementsService,
  ) {}

  /** The courses whose staff I'm on, with what I may do in each. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  courses(@CurrentUser() user: AuthUser) {
    return this.teaching.courses(user);
  }

  @Get(':courseId')
  @CourseCan(ANY_STAFF)
  @Header('Cache-Control', 'private, no-store')
  course(@Param('courseId') courseId: string, @Req() req: CourseRequest) {
    return this.teaching.course(courseId, req.courseMembership!);
  }

  // ------------------------------------------------------------------ assessments

  @CourseCan('MANAGE_ASSESSMENTS', 'GRADE')
  @Get(':courseId/assessments')
  @Header('Cache-Control', 'private, no-store')
  list(@Param('courseId') courseId: string) {
    return this.assessments.list(courseId, false);
  }

  @CourseCan('MANAGE_ASSESSMENTS')
  @Post(':courseId/assessments')
  @Throttle(WRITE_LIMIT)
  async create(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(assessmentInputSchema)) body: AssessmentInput) {
    // Each published one tells every enrolled student: a daily cap keeps a mistake (or a script) from flooding them.
    await this.teaching.assertCreateQuota(user.id);
    return this.assessments.create(courseId, body, user, false);
  }

  @CourseCan('MANAGE_ASSESSMENTS')
  @Put(':courseId/assessments/order')
  @Throttle(WRITE_LIMIT)
  async reorder(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(assessmentOrderSchema)) body: AssessmentOrderInput) {
    await this.assessments.assertAssessmentsInCourse(courseId, body.ids);
    return this.assessments.reorder(courseId, body.ids, user, false);
  }

  @CourseCan('GRADE')
  @Get(':courseId/gradebook.csv')
  @Throttle(WRITE_LIMIT)
  async gradebook(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Res() res: Response) {
    const csv = await this.assessments.gradebookCsv(courseId, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gradebook-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }

  @CourseCan('MANAGE_ASSESSMENTS', 'GRADE')
  @Get(':courseId/assessments/:id')
  @Header('Cache-Control', 'private, no-store')
  async get(@Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    return this.assessments.get(id, false);
  }

  /** Saving also publishes (status PUBLISHED): the students are told once, as for admins. */
  @CourseCan('MANAGE_ASSESSMENTS')
  @Put(':courseId/assessments/:id')
  @Throttle(WRITE_LIMIT)
  async update(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string, @Body(new ZodPipe(assessmentInputSchema)) body: AssessmentInput) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    return this.assessments.update(id, body, user, false);
  }

  @CourseCan('MANAGE_ASSESSMENTS')
  @Delete(':courseId/assessments/:id')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async remove(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    await this.assessments.remove(id, user);
  }

  // ------------------------------------------------------------------ grading

  @CourseCan('GRADE')
  @Get(':courseId/assessments/:id/submissions')
  @Header('Cache-Control', 'private, no-store')
  async submissions(@Param('courseId') courseId: string, @Param('id') id: string, @Query(new ZodPipe(submissionFilterSchema)) q: z.infer<typeof submissionFilterSchema>) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    return this.assessments.submissions(id, q.filter, false);
  }

  @CourseCan('GRADE')
  @Get(':courseId/submissions/:id')
  @Header('Cache-Control', 'private, no-store')
  async submission(@Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertSubmissionInCourse(courseId, id);
    return this.assessments.submission(id, false);
  }

  @CourseCan('GRADE')
  @Get(':courseId/submissions/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Throttle(GRADE_LIMIT)
  async file(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertSubmissionInCourse(courseId, id);
    return this.assessments.fileUrl(id, user);
  }

  /** Score + feedback: the student is told in-app and by email, as for admins. */
  @CourseCan('GRADE')
  @Put(':courseId/submissions/:id/grade')
  @Throttle(GRADE_LIMIT)
  async grade(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string, @Body(new ZodPipe(gradeInputSchema)) body: GradeInput) {
    await this.assessments.assertSubmissionInCourse(courseId, id);
    return this.assessments.grade(id, body, user, false);
  }

  // ------------------------------------------------------------------ points

  @CourseCan('MANAGE_POINTS')
  @Get(':courseId/points')
  @Header('Cache-Control', 'private, no-store')
  points(@Param('courseId') courseId: string) {
    return this.teaching.pointsOverview(courseId);
  }

  /** Course points for an enrolled student (negative takes them away), with a reason. */
  @CourseCan('MANAGE_POINTS')
  @Post(':courseId/points')
  @Throttle(WRITE_LIMIT)
  award(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(teachingPointsSchema)) body: TeachingPointsInput) {
    return this.teaching.award(courseId, body, user);
  }

  /** One enrolled student's entries in this course (removed ones too) and the speaker's cap. 404 for anyone else. */
  @CourseCan('MANAGE_POINTS')
  @Get(':courseId/students/:userId/points')
  @Header('Cache-Control', 'private, no-store')
  async studentPoints(@Param('courseId') courseId: string, @Param('userId') userId: string) {
    return this.ledger.courseStudent(courseId, userId, await this.teaching.pointsCap());
  }

  /** Edits a manual entry of this course (void + replace), within the speaker cap. Automatic entries: 409. */
  @CourseCan('MANAGE_POINTS')
  @Patch(':courseId/points/:entryId')
  @Throttle(WRITE_LIMIT)
  async editPoints(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('entryId') entryId: string, @Body(new ZodPipe(pointsEditSchema)) body: PointsEditInput) {
    return this.ledger.editEntry(entryId, body, user, { kind: 'course', courseId, cap: await this.teaching.pointsCap() });
  }

  /** Removes (voids) a manual entry of this course, within the speaker cap. */
  @CourseCan('MANAGE_POINTS')
  @Post(':courseId/points/:entryId/void')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  async voidPoints(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('entryId') entryId: string, @Body(new ZodPipe(pointsVoidSchema)) body: PointsVoidInput) {
    return this.ledger.voidEntry(entryId, body, user, { kind: 'course', courseId, cap: await this.teaching.pointsCap() });
  }

  // ------------------------------------------------------------------ attendance

  @CourseCan('UPLOAD_ATTENDANCE')
  @Get(':courseId/attendance')
  @Header('Cache-Control', 'private, no-store')
  attendanceCourse(@Param('courseId') courseId: string) {
    return this.attendance.course(courseId);
  }

  @CourseCan('UPLOAD_ATTENDANCE')
  @Get(':courseId/attendance.csv')
  @Throttle(WRITE_LIMIT)
  async attendanceCsv(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Res() res: Response) {
    await sendAttendanceCsv(res, this.attendance.csv(courseId, user));
  }

  @CourseCan('UPLOAD_ATTENDANCE')
  @Get(':courseId/sessions/:sessionId/attendance')
  @Header('Cache-Control', 'private, no-store')
  attendanceSession(@Param('courseId') courseId: string, @Param('sessionId') sessionId: string) {
    return this.attendance.session(courseId, sessionId);
  }

  /** dryRun (default): the preview. dryRun false: replaces the session's attendance and adjusts points. */
  @CourseCan('UPLOAD_ATTENDANCE')
  @Post(':courseId/sessions/:sessionId/attendance')
  @HttpCode(200)
  @Throttle(GRADE_LIMIT)
  attendanceUpload(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('sessionId') sessionId: string, @Body(new ZodPipe(attendanceUploadSchema)) body: AttendanceUploadInput) {
    return this.attendance.upload(courseId, sessionId, body, user);
  }

  @CourseCan('UPLOAD_ATTENDANCE')
  @Put(':courseId/sessions/:sessionId/attendance/:userId')
  @Throttle(GRADE_LIMIT)
  attendanceMark(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
    @Param('sessionId') sessionId: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(attendanceMarkSchema)) body: AttendanceMarkInput,
  ) {
    return this.attendance.mark(courseId, sessionId, userId, body.status, user);
  }

  // ------------------------------------------------------------------ materials

  /** A session's text and links only (not its dates, title or live link). */
  @CourseCan('MANAGE_MATERIALS')
  @Put(':courseId/sessions/:sessionId/materials')
  @Throttle(WRITE_LIMIT)
  materials(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('sessionId') sessionId: string, @Body(new ZodPipe(sessionMaterialsSchema)) body: SessionMaterialsInput) {
    return this.teaching.updateMaterials(courseId, sessionId, body, user);
  }

  // ------------------------------------------------------------------ announcements

  /** Who would get a message, what the staff sent (counts only), the limits. */
  @Get(':courseId/announcements')
  @CourseCan('ANNOUNCE')
  @Header('Cache-Control', 'private, no-store')
  announcementsOverview(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string) {
    return this.announcements.courseOverview(courseId, user.id);
  }

  /** To the course's enrolled students, at once (in-app and email), "From" the sender. */
  @Post(':courseId/announcements')
  @CourseCan('ANNOUNCE')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  announce(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(speakerAnnouncementSchema)) body: SpeakerAnnouncementInput) {
    return this.announcements.send(user, 'course', courseId, body);
  }
}
