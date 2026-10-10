import { Body, Controller, Get, Header, HttpCode, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  quizAnswersSchema,
  workSubmissionSchema,
  type AssessmentDetailDto,
  type AssessmentSummaryDto,
  type MySubmissionDto,
  type QuizAttemptDto,
  type QuizResultDto,
  type WorkSubmissionInput,
} from '@academy/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MAX_UPLOAD_BYTES } from '../storage/file-type';
import { AssessmentsService } from './assessments.service';

/** Students take quizzes and hand in labs and assignments (enrolled students only). */
@ApiTags('assessments')
@Controller('learn/:slug/assessments')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<AssessmentSummaryDto[]> {
    return this.assessments.list(user, slug);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('id') id: string): Promise<AssessmentDetailDto> {
    return this.assessments.detail(user, slug, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('id') id: string): Promise<QuizAttemptDto> {
    return this.assessments.start(user, slug, id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submitQuiz(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body(new ZodPipe(quizAnswersSchema)) body: z.infer<typeof quizAnswersSchema>,
  ): Promise<QuizResultDto> {
    return this.assessments.submitQuiz(user, slug, id, body.answers);
  }

  @Post(':id/submission')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submitWork(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body(new ZodPipe(workSubmissionSchema)) body: WorkSubmissionInput,
  ): Promise<MySubmissionDto> {
    return this.assessments.submitWork(user, slug, id, body);
  }

  @Post(':id/submission/file')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 2, fieldSize: 4_000 } }))
  submitFile(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { note?: unknown },
  ): Promise<MySubmissionDto> {
    return this.assessments.submitFile(user, slug, id, file, typeof body?.note === 'string' ? body.note : null);
  }

  /** A short-lived link to the student's own uploaded PDF. */
  @Get(':id/file')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  file(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('id') id: string): Promise<{ url: string; expiresIn: number }> {
    return this.assessments.myFileUrl(user, slug, id);
  }
}
