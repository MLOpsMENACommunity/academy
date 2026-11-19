import { Controller, Get, Header, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  catalogQuerySchema,
  type CatalogQuery,
  type CourseDetailDto,
  type CourseSummaryDto,
  type MyCourseStatusDto,
  type PrivateCourseFlagDto,
} from '@academy/shared';
import type { Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CoursesService } from './courses.service';

@ApiTags('courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  // Public reads aren't throttled: the Next server renders pages for every visitor from one IP.
  @Public()
  @SkipThrottle()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  list(@Query(new ZodPipe(catalogQuerySchema)) q: CatalogQuery): Promise<CourseSummaryDto[]> {
    return this.courses.listPublic(q);
  }

  @Public()
  @SkipThrottle()
  @Get('slugs')
  slugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    return this.courses.publicSlugs();
  }

  /**
   * A private course answers only a signed-in account on its list (404 for everyone else), and
   * that answer is `private, no-store`: never kept by a browser, the edge or the public cache
   * (which only ever stores anonymous answers, and an anonymous request never gets one).
   */
  @Public()
  @SkipThrottle()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60')
  async get(@Param('slug') slug: string, @CurrentUser() user: AuthUser | undefined, @Res({ passthrough: true }) res: Response): Promise<CourseDetailDto> {
    let r: Awaited<ReturnType<CoursesService['getPublic']>>;
    try {
      r = await this.courses.getPublic(slug, user?.id);
    } catch (err) {
      // A 404 can turn into the course once the visitor signs in: no browser may keep it.
      res.setHeader('Cache-Control', 'no-store');
      throw err;
    }
    if (r.private) res.setHeader('Cache-Control', 'private, no-store');
    return r.course;
  }

  /**
   * 200 `{ private: true }` only when a private course lives at this address, 404 otherwise: lets
   * the course page tell "sign in to see it" from "doesn't exist", revealing nothing else.
   * Not throttled, like the other public reads (the web server asks for every unknown course page
   * from one IP, and a throttled answer would show a private course as "not found"); one indexed
   * lookup by slug. Never cached.
   */
  @Public()
  @SkipThrottle()
  @Get(':slug/private')
  @Header('Cache-Control', 'no-store')
  async isPrivate(@Param('slug') slug: string): Promise<PrivateCourseFlagDto> {
    if (!(await this.courses.isPrivate(slug))) throw new NotFoundException('Course not found');
    return { private: true };
  }

  /** The signed-in user's application status for this course (shown on the course page). */
  @Get(':slug/my-status')
  @Header('Cache-Control', 'private, no-store')
  myStatus(@Param('slug') slug: string, @CurrentUser() user: AuthUser): Promise<MyCourseStatusDto> {
    return this.courses.myStatus(slug, user.id);
  }
}

@ApiTags('courses')
@Controller('me')
export class MyPrivateCoursesController {
  constructor(private readonly courses: CoursesService) {}

  /** Private courses shared with the signed-in account (confirmed email on the course's list). */
  @Get('private-courses')
  @Header('Cache-Control', 'private, no-store')
  privateCourses(@CurrentUser() user: AuthUser): Promise<CourseSummaryDto[]> {
    return this.courses.privateFor(user.id);
  }
}
