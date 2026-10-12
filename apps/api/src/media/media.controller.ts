import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  MEDIA_MAX_BYTES,
  mediaCourseSchema,
  mediaCourseSessionSchema,
  mediaEventSchema,
  mediaInstructorSchema,
  type MediaCourseInput,
  type MediaCourseSessionInput,
  type MediaEventInput,
  type MediaInstructorInput,
} from '@academy/shared';
import type { Response } from 'express';
import { AdminCan, CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MediaService } from './media.service';

/**
 * Uploaded images, public: /api/media/<uuid>.<jpg|png|webp>. A name is never reused (a new
 * upload gets a new one), so browsers and the Cloudflare edge may keep it for a year.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Public()
  @Get(':name')
  async get(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const file = await this.media.read(name);
    if (!file) throw new NotFoundException('Not found');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.body.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    // Public images: other sites (e.g. mlopsmena.com) and link previews may show them.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(file.body);
  }
}

/**
 * Admin → Media: upload an image, and change only the image and video fields of courses,
 * course sessions, live sessions and speakers. The content preset (CONTENT) works here and
 * nowhere else; the full editors (and their DTOs) stay with ACADEMIC and SPEAKERS.
 */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('CONTENT')
@Controller('admin/media')
export class AdminMediaController {
  constructor(private readonly media: MediaService) {}

  /** Also used by the course, live session and speaker editors (their image fields). */
  @Post('upload')
  @AdminCan('CONTENT', 'ACADEMIC', 'SPEAKERS')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.media.upload(file, user.id);
  }

  @Get('library')
  library() {
    return this.media.library();
  }

  @Patch('courses/:id')
  course(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(mediaCourseSchema)) body: MediaCourseInput) {
    return this.media.updateCourse(id, body, user.id);
  }

  @Patch('courses/:id/sessions/:sessionId')
  courseSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodPipe(mediaCourseSessionSchema)) body: MediaCourseSessionInput,
  ) {
    return this.media.updateCourseSession(id, sessionId, body, user.id);
  }

  @Patch('events/:id')
  event(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(mediaEventSchema)) body: MediaEventInput) {
    return this.media.updateEvent(id, body, user.id);
  }

  @Patch('instructors/:id')
  instructor(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(mediaInstructorSchema)) body: MediaInstructorInput) {
    return this.media.updateInstructor(id, body, user.id);
  }
}
