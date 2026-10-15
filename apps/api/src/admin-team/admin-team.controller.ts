import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { addAdminSchema, updateAdminSchema, type AddAdminInput, type UpdateAdminInput } from '@academy/shared';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AdminTeamService } from './admin-team.service';

/** Admin → Team: the admins and their presets. Super admins only. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('SUPER')
@Controller('admin/team')
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get()
  list() {
    return this.team.list();
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  add(@CurrentUser() user: AuthUser, @Body(new ZodPipe(addAdminSchema)) body: AddAdminInput) {
    return this.team.add(body, user.id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateAdminSchema)) body: UpdateAdminInput) {
    return this.team.update(id, body.permissions, user.id);
  }

  /** Back to the account they had (a speaker keeps the speaker portal, anyone else becomes a student). */
  @Post(':id/remove')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ ok: true }> {
    await this.team.remove(id, user.id);
    return { ok: true };
  }
}
