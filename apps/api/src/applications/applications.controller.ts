import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ADMIN_PERMISSIONS,
  adminTransitionSchema,
  applySchema,
  type AdminTransitionInput,
  type ApplyInput,
  type MyApplicationDetailDto,
  type MyApplicationDto,
} from '@academy/shared';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ApplicationsService } from './applications.service';
import { ApplicationWorkflow } from './workflow.service';

@ApiTags('applications')
@Controller()
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly workflow: ApplicationWorkflow,
  ) {}

  /** Students (and admins testing). One account, one role: a speaker asks the team to switch the account to study. */
  @Roles('STUDENT', 'ADMIN')
  // Any admin may try the student flow on their own account.
  @AdminCan(...ADMIN_PERMISSIONS)
  @Post('applications')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  apply(@CurrentUser() user: AuthUser, @Body(new ZodPipe(applySchema)) body: ApplyInput): Promise<MyApplicationDetailDto> {
    return this.applications.apply(user.id, body);
  }

  @Get('me/applications')
  listMine(@CurrentUser() user: AuthUser): Promise<MyApplicationDto[]> {
    return this.applications.listMine(user.id);
  }

  @Get('me/applications/:id')
  getMine(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<MyApplicationDetailDto> {
    return this.applications.getMine(user.id, id);
  }

  /** Single-application status change by an admin (the admin panel adds bulk actions). */
  @Roles('ADMIN')
  @AdminCan('ADMISSIONS')
  @Post('admin/applications/:id/transition')
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(adminTransitionSchema)) body: AdminTransitionInput,
  ): Promise<{ id: string; status: string }> {
    const app = await this.workflow.transition(id, body.event, user, { reason: body.reason });
    return { id: app.id, status: app.status };
  }
}
