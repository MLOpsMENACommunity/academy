import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  catalogQuerySchema,
  type CatalogQuery,
  type CourseDetailDto,
  type CourseSummaryDto,
  type MyCourseStatusDto,
} from '@academy/shared';
import { CurrentUser, Public, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CoursesService } from './courses.service';

@ApiTags('courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  list(@Query(new ZodPipe(catalogQuerySchema)) q: CatalogQuery): Promise<CourseSummaryDto[]> {
    return this.courses.listPublic(q);
  }

  @Public()
  @Get('slugs')
  slugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    return this.courses.publicSlugs();
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60')
  get(@Param('slug') slug: string): Promise<CourseDetailDto> {
    return this.courses.getPublic(slug);
  }

  /** The signed-in user's application status for this course (shown on the course page). */
  @Get(':slug/my-status')
  @Header('Cache-Control', 'private, no-store')
  myStatus(@Param('slug') slug: string, @CurrentUser() user: AuthUser): Promise<MyCourseStatusDto> {
    return this.courses.myStatus(slug, user.id);
  }
}
