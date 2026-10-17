import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  addCourseStaffSchema,
  courseRoleInputSchema,
  updateCourseStaffSchema,
  type AddCourseStaffInput,
  type CourseRoleInput,
  type UpdateCourseStaffInput,
} from '@academy/shared';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CourseStaffService } from './course-staff.service';

const WRITE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/** Admin → Courses → {course} → Staff: the course's roles and the people in them. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('ACADEMIC')
@Controller('admin/courses/:id/staff')
export class AdminCourseStaffController {
  constructor(private readonly staff: CourseStaffService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@Param('id') id: string) {
    return this.staff.get(id);
  }

  @Post('roles')
  @Throttle(WRITE_LIMIT)
  createRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(courseRoleInputSchema)) body: CourseRoleInput) {
    return this.staff.createRole(id, body, user);
  }

  @Put('roles/:roleId')
  @Throttle(WRITE_LIMIT)
  updateRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('roleId') roleId: string, @Body(new ZodPipe(courseRoleInputSchema)) body: CourseRoleInput) {
    return this.staff.updateRole(id, roleId, body, user);
  }

  @Delete('roles/:roleId')
  @Throttle(WRITE_LIMIT)
  deleteRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('roleId') roleId: string) {
    return this.staff.deleteRole(id, roleId, user);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(addCourseStaffSchema)) body: AddCourseStaffInput) {
    return this.staff.add(id, body, user);
  }

  @Put(':staffId')
  @Throttle(WRITE_LIMIT)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('staffId') staffId: string, @Body(new ZodPipe(updateCourseStaffSchema)) body: UpdateCourseStaffInput) {
    return this.staff.update(id, staffId, body, user);
  }

  @Delete(':staffId')
  @Throttle(WRITE_LIMIT)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('staffId') staffId: string) {
    return this.staff.remove(id, staffId, user);
  }
}
