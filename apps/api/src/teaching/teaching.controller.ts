import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  assessmentInputSchema,
  assessmentOrderSchema,
  gradeInputSchema,
  sessionMaterialsSchema,
  submissionFilterSchema,
  teachingPointsSchema,
  type AssessmentInput,
  type AssessmentOrderInput,
  type GradeInput,
  type SessionMaterialsInput,
  type TeachingPointsInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminAssessmentsService } from '../assessments/admin-assessments.service';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { TeachesCourseGuard } from './teaches-course.guard';
import { TeachingService } from './teaching.service';

/** Changes: generous for a speaker at work, small enough to stop a runaway script. */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
/** Grading a whole class goes quickly, one save per student. */
const GRADE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/**
 * Speaker portal → My courses → {course}: speakers teach the courses they are assigned to.
 * SPEAKER accounts only (admins use the same services under /admin). TeachesCourseGuard checks
 * the course on every request (403 NOT_YOUR_COURSE); each handler checks that the assessment,
 * submission or session id is one of that course's (404 otherwise). Writes reuse the admin
 * services, so they are audited with the speaker as the actor and tell students the same way.
 */
@ApiTags('speaker')
@Roles('SPEAKER')
@UseGuards(TeachesCourseGuard)
@Controller('speaker/courses')
export class TeachingController {
  constructor(
    private readonly teaching: TeachingService,
    private readonly assessments: AdminAssessmentsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  courses(@CurrentUser() user: AuthUser) {
    return this.teaching.courses(user.id);
  }

  @Get(':courseId')
  @Header('Cache-Control', 'private, no-store')
  course(@Param('courseId') courseId: string) {
    return this.teaching.course(courseId);
  }

  // ------------------------------------------------------------------ assessments

  @Get(':courseId/assessments')
  @Header('Cache-Control', 'private, no-store')
  list(@Param('courseId') courseId: string) {
    return this.assessments.list(courseId, false);
  }

  @Post(':courseId/assessments')
  @Throttle(WRITE_LIMIT)
  async create(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(assessmentInputSchema)) body: AssessmentInput) {
    // Each published one tells every enrolled student: a daily cap keeps a mistake (or a script) from flooding them.
    await this.teaching.assertCreateQuota(user.id);
    return this.assessments.create(courseId, body, user, false);
  }

  @Put(':courseId/assessments/order')
  @Throttle(WRITE_LIMIT)
  async reorder(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(assessmentOrderSchema)) body: AssessmentOrderInput) {
    await this.assessments.assertAssessmentsInCourse(courseId, body.ids);
    return this.assessments.reorder(courseId, body.ids, user, false);
  }

  @Get(':courseId/gradebook.csv')
  @Throttle(WRITE_LIMIT)
  async gradebook(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Res() res: Response) {
    const csv = await this.assessments.gradebookCsv(courseId, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gradebook-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }

  @Get(':courseId/assessments/:id')
  @Header('Cache-Control', 'private, no-store')
  async get(@Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    return this.assessments.get(id, false);
  }

  /** Saving also publishes (status PUBLISHED): the students are told once, as for admins. */
  @Put(':courseId/assessments/:id')
  @Throttle(WRITE_LIMIT)
  async update(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string, @Body(new ZodPipe(assessmentInputSchema)) body: AssessmentInput) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    return this.assessments.update(id, body, user, false);
  }

  @Delete(':courseId/assessments/:id')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async remove(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    await this.assessments.remove(id, user);
  }

  // ------------------------------------------------------------------ grading

  @Get(':courseId/assessments/:id/submissions')
  @Header('Cache-Control', 'private, no-store')
  async submissions(@Param('courseId') courseId: string, @Param('id') id: string, @Query(new ZodPipe(submissionFilterSchema)) q: z.infer<typeof submissionFilterSchema>) {
    await this.assessments.assertAssessmentInCourse(courseId, id);
    return this.assessments.submissions(id, q.filter, false);
  }

  @Get(':courseId/submissions/:id')
  @Header('Cache-Control', 'private, no-store')
  async submission(@Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertSubmissionInCourse(courseId, id);
    return this.assessments.submission(id, false);
  }

  @Get(':courseId/submissions/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Throttle(GRADE_LIMIT)
  async file(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string) {
    await this.assessments.assertSubmissionInCourse(courseId, id);
    return this.assessments.fileUrl(id, user);
  }

  /** Score + feedback: the student is told in-app and by email, as for admins. */
  @Put(':courseId/submissions/:id/grade')
  @Throttle(GRADE_LIMIT)
  async grade(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string, @Body(new ZodPipe(gradeInputSchema)) body: GradeInput) {
    await this.assessments.assertSubmissionInCourse(courseId, id);
    return this.assessments.grade(id, body, user, false);
  }

  // ------------------------------------------------------------------ points

  @Get(':courseId/points')
  @Header('Cache-Control', 'private, no-store')
  points(@Param('courseId') courseId: string) {
    return this.teaching.pointsOverview(courseId);
  }

  /** Course points for an enrolled student (negative takes them away), with a reason. */
  @Post(':courseId/points')
  @Throttle(WRITE_LIMIT)
  award(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(teachingPointsSchema)) body: TeachingPointsInput) {
    return this.teaching.award(courseId, body, user);
  }

  // ------------------------------------------------------------------ materials

  /** A session's text and links only (not its dates, title or live link). */
  @Put(':courseId/sessions/:sessionId/materials')
  @Throttle(WRITE_LIMIT)
  materials(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('sessionId') sessionId: string, @Body(new ZodPipe(sessionMaterialsSchema)) body: SessionMaterialsInput) {
    return this.teaching.updateMaterials(courseId, sessionId, body, user);
  }
}
