import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  assessmentInputSchema,
  assessmentOrderSchema,
  gradeInputSchema,
  quizImportSchema,
  submissionFilterSchema,
  type AssessmentInput,
  type AssessmentOrderInput,
  type GradeInput,
  type QuizImportInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AdminAssessmentsService } from './admin-assessments.service';

/** Admin: the course's Assessments tab, the quiz builder and the gradebook. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('ACADEMIC')
@Controller('admin')
export class AdminAssessmentsController {
  constructor(private readonly assessments: AdminAssessmentsService) {}

  @Get('courses/:id/assessments')
  list(@Param('id') id: string) {
    return this.assessments.list(id);
  }

  @Post('courses/:id/assessments')
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(assessmentInputSchema)) body: AssessmentInput) {
    return this.assessments.create(id, body, user);
  }

  /** Many quizzes from one spreadsheet (parsed in the browser), each on a session: all saved or none. */
  @Post('courses/:id/assessments/import')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  importQuizzes(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(quizImportSchema)) body: QuizImportInput) {
    return this.assessments.importQuizzes(id, body, user);
  }

  /** The ↑/↓ buttons: the course's assessment ids in their new order. */
  @Put('courses/:id/assessments/order')
  reorder(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(assessmentOrderSchema)) body: AssessmentOrderInput) {
    return this.assessments.reorder(id, body.ids, user);
  }

  @Get('courses/:id/gradebook.csv')
  async gradebook(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const csv = await this.assessments.gradebookCsv(id, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gradebook-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }

  @Get('assessments/:id')
  get(@Param('id') id: string) {
    return this.assessments.get(id);
  }

  @Put('assessments/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(assessmentInputSchema)) body: AssessmentInput) {
    return this.assessments.update(id, body, user);
  }

  @Delete('assessments/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.assessments.remove(id, user);
  }

  @Get('assessments/:id/submissions')
  submissions(@Param('id') id: string, @Query(new ZodPipe(submissionFilterSchema)) q: z.infer<typeof submissionFilterSchema>) {
    return this.assessments.submissions(id, q.filter);
  }

  @Get('submissions/:id')
  submission(@Param('id') id: string) {
    return this.assessments.submission(id);
  }

  @Get('submissions/:id/file')
  @Header('Cache-Control', 'private, no-store')
  file(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assessments.fileUrl(id, user);
  }

  @Put('submissions/:id/grade')
  grade(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(gradeInputSchema)) body: GradeInput) {
    return this.assessments.grade(id, body, user);
  }
}
