import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ADMIN_PROFILE_SECTIONS, addStudentSchema, typedConfirmSchema, type AddStudentInput, type AdminProfileSection, type ProfileDto } from '@academy/shared';
import type { z } from 'zod';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';
import { ProfileService } from './profile.service';

/**
 * Admin → Students: the team adds, edits and deletes student (and speaker) accounts. Every
 * change is audited with ids and field names only. Admin accounts are never edited here.
 */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('ADMISSIONS')
@Controller('admin/students')
export class AdminAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly account: AccountService,
  ) {}

  /** A live, non-admin account, or 404/403. */
  private async editable(id: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { role: true, deletedAt: true } });
    if (!u || u.deletedAt) throw new NotFoundException('Student not found');
    if (u.role === 'ADMIN') throw new ForbiddenException({ code: 'ADMIN_ACCOUNT', message: "An admin account can't be edited or deleted here" });
  }

  /** "Add student": creates the account; they choose their own password from the email. */
  @Post()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  add(@CurrentUser() user: AuthUser, @Body(new ZodPipe(addStudentSchema)) body: AddStudentInput) {
    return this.account.createByAdmin(body, user.id);
  }

  @Put(':id/profile/:section')
  async updateSection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('section') section: string, @Body() body: unknown): Promise<ProfileDto> {
    if (!(ADMIN_PROFILE_SECTIONS as readonly string[]).includes(section)) throw new BadRequestException('Unknown profile section');
    await this.editable(id);
    return this.profiles.adminUpdateSection(id, section as AdminProfileSection, body, user.id);
  }

  /** The same soft delete (and anonymisation 30 days later) as the student's own. */
  @Post(':id/delete')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(typedConfirmSchema)) body: z.infer<typeof typedConfirmSchema>): Promise<{ ok: true }> {
    await this.account.deleteByAdmin(id, body.confirm, user.id);
    return { ok: true };
  }
}
