import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  automationPauseSchema,
  type AutomationLogEntryDto,
  type AutomationOverviewDto,
  type AutomationPreviewDto,
} from '@academy/shared';
import { z } from 'zod';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CourseCan, CoursePermissionGuard } from '../course-access/course-permission.guard';
import { AutomationService } from './automation.service';

type Pause = z.infer<typeof automationPauseSchema>;

/** Admin → Courses → course → Automation (ACADEMIC). */
@ApiTags('automation')
@Roles('ADMIN')
@Controller('admin/courses')
export class AdminAutomationController {
  constructor(private readonly automation: AutomationService) {}

  @AdminCan('ACADEMIC')
  @Get(':id/automation')
  overview(@Param('id') id: string): Promise<AutomationOverviewDto> {
    return this.automation.overview(id);
  }

  @AdminCan('ACADEMIC')
  @Put(':id/automation')
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(automationPauseSchema)) body: Pause): Promise<AutomationOverviewDto> {
    return this.automation.setPaused(id, body.paused, user.id);
  }

  @AdminCan('ACADEMIC')
  @Post(':id/automation/recommended')
  @HttpCode(200)
  recommended(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AutomationOverviewDto> {
    return this.automation.enableRecommended(id, user.id);
  }

  @AdminCan('ACADEMIC')
  @Put(':id/automation/rules/:type')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  save(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('type') type: string, @Body() body: unknown): Promise<AutomationOverviewDto> {
    return this.automation.save(id, type, body, user.id);
  }

  @AdminCan('ACADEMIC')
  @Post(':id/automation/rules/:type/preview')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  preview(@Param('id') id: string, @Param('type') type: string, @Body() body: unknown): Promise<AutomationPreviewDto> {
    return this.automation.preview(id, type, body);
  }

  @AdminCan('ACADEMIC')
  @Get(':id/automation/log')
  log(@Param('id') id: string): Promise<AutomationLogEntryDto[]> {
    return this.automation.log(id);
  }
}

/** /teach/courses/:courseId → Automation, for course staff with "Manage automation rules". */
@ApiTags('automation')
@UseGuards(CoursePermissionGuard)
@Controller('teach/courses')
export class TeachAutomationController {
  constructor(private readonly automation: AutomationService) {}

  @CourseCan('MANAGE_RULES')
  @Get(':courseId/automation')
  overview(@Param('courseId') id: string): Promise<AutomationOverviewDto> {
    return this.automation.overview(id);
  }

  @CourseCan('MANAGE_RULES')
  @Put(':courseId/automation')
  pause(@CurrentUser() user: AuthUser, @Param('courseId') id: string, @Body(new ZodPipe(automationPauseSchema)) body: Pause): Promise<AutomationOverviewDto> {
    return this.automation.setPaused(id, body.paused, user.id);
  }

  @CourseCan('MANAGE_RULES')
  @Post(':courseId/automation/recommended')
  @HttpCode(200)
  recommended(@CurrentUser() user: AuthUser, @Param('courseId') id: string): Promise<AutomationOverviewDto> {
    return this.automation.enableRecommended(id, user.id);
  }

  @CourseCan('MANAGE_RULES')
  @Put(':courseId/automation/rules/:type')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  save(@CurrentUser() user: AuthUser, @Param('courseId') id: string, @Param('type') type: string, @Body() body: unknown): Promise<AutomationOverviewDto> {
    return this.automation.save(id, type, body, user.id);
  }

  @CourseCan('MANAGE_RULES')
  @Post(':courseId/automation/rules/:type/preview')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  preview(@Param('courseId') id: string, @Param('type') type: string, @Body() body: unknown): Promise<AutomationPreviewDto> {
    return this.automation.preview(id, type, body);
  }

  @CourseCan('MANAGE_RULES')
  @Get(':courseId/automation/log')
  log(@Param('courseId') id: string): Promise<AutomationLogEntryDto[]> {
    return this.automation.log(id);
  }
}
