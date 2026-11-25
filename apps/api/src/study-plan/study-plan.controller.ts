import { Body, Controller, Delete, Get, Header, HttpCode, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { studyPlanSchema, type StudyPlanDto, type StudyPlanInput } from '@academy/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { StudyPlanService } from './study-plan.service';

/** The learn page's study plan card (self-paced courses, enrolled students). */
@ApiTags('learn')
@Controller('learn/:slug/study-plan')
export class StudyPlanController {
  constructor(private readonly plans: StudyPlanService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<StudyPlanDto> {
    return this.plans.get(user, slug);
  }

  @Put()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  save(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body(new ZodPipe(studyPlanSchema)) body: StudyPlanInput): Promise<StudyPlanDto> {
    return this.plans.save(user, slug, body);
  }

  @Delete()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async remove(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<void> {
    await this.plans.remove(user, slug);
  }
}
