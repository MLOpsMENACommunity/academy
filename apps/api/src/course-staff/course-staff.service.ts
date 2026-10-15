import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BUILTIN_COURSE_ROLES,
  COURSE_PERMISSIONS,
  type AddCourseStaffInput,
  type CourseRoleDto,
  type CourseRoleInput,
  type CourseStaffDto,
  type CourseStaffMemberDto,
  type PublicStaffGroupDto,
  type UpdateCourseStaffInput,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ensureBuiltinRoles, syncCourseInstructors } from './staff-sync';

type Tx = Prisma.TransactionClient;

const staffInclude = {
  user: { select: { id: true, email: true, role: true, deletedAt: true, profile: { select: { fullNameEn: true } } } },
  instructor: { select: { id: true, name: true, slug: true, photoUrl: true } },
  role: { select: { visibility: true } },
} satisfies Prisma.CourseStaffInclude;

function staffDto(s: Prisma.CourseStaffGetPayload<{ include: typeof staffInclude }>): CourseStaffMemberDto {
  return {
    id: s.id,
    roleId: s.roleId,
    order: s.order,
    user: s.user
      ? { id: s.user.id, email: s.user.email, name: s.user.profile?.fullNameEn ?? null, role: s.user.role, deleted: Boolean(s.user.deletedAt) }
      : null,
    instructor: s.instructor ? { id: s.instructor.id, name: s.instructor.name, slug: s.instructor.slug, photoUrl: s.instructor.photoUrl } : null,
    shown: s.role.visibility === 'SHOWN',
    displayOnly: !s.user,
  };
}

/**
 * Admin → Courses → {course} → Staff: the course's roles (name, permissions, Shown/Anonymous)
 * and the people in them. Also the public course page's staff section. Every change is audited
 * and rewrites the derived CourseInstructor list (staff-sync.ts).
 */
@Injectable()
export class CourseStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async course(courseId: string, tx: Tx = this.prisma): Promise<void> {
    const c = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!c) throw new NotFoundException('Course not found');
  }

  /** A course without any role (made by the seed or the archive import) gets the built-in three. */
  private async ensureRoles(courseId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.courseRole.count({ where: { courseId } });
      await ensureBuiltinRoles(tx, courseId, n ? ['MAIN'] : BUILTIN_COURSE_ROLES);
    });
  }

  async get(courseId: string): Promise<CourseStaffDto> {
    await this.course(courseId);
    await this.ensureRoles(courseId);
    const [roles, staff] = await Promise.all([
      this.prisma.courseRole.findMany({ where: { courseId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], include: { _count: { select: { staff: true } } } }),
      this.prisma.courseStaff.findMany({ where: { courseId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], include: staffInclude }),
    ]);
    const main = roles.find((r) => r.builtin === 'MAIN');
    const mains = main ? staff.filter((s) => s.roleId === main.id).length : 0;
    return {
      roles: roles.map(
        (r): CourseRoleDto => ({
          id: r.id,
          name: r.name,
          nameAr: r.nameAr,
          permissions: COURSE_PERMISSIONS.filter((p) => r.permissions.includes(p)),
          visibility: r.visibility,
          builtin: r.builtin,
          order: r.order,
          members: r._count.staff,
        }),
      ),
      staff: staff.map(staffDto),
      noMainInstructor: mains === 0,
      multipleMainInstructors: mains > 1,
    };
  }

  // ------------------------------------------------------------------ roles

  private async role(courseId: string, roleId: string, tx: Tx = this.prisma) {
    const r = await tx.courseRole.findFirst({ where: { id: roleId, courseId } });
    if (!r) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    return r;
  }

  private async nameFree(tx: Tx, courseId: string, name: string, exceptId?: string): Promise<void> {
    const clash = await tx.courseRole.findFirst({
      where: { courseId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException({ code: 'ROLE_NAME_TAKEN', message: 'This course already has a role with that name' });
  }

  async createRole(courseId: string, input: CourseRoleInput, actor: Actor): Promise<CourseStaffDto> {
    await this.course(courseId);
    await this.ensureRoles(courseId);
    await this.prisma.$transaction(async (tx) => {
      // One role change at a time per course (names stay unique without a database constraint).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`course-roles:${courseId}`}))`;
      await this.nameFree(tx, courseId, input.name);
      if ((await tx.courseRole.count({ where: { courseId } })) >= 30) {
        throw new BadRequestException({ code: 'TOO_MANY_ROLES', message: 'A course can have at most 30 roles' });
      }
      const last = await tx.courseRole.aggregate({ where: { courseId }, _max: { order: true } });
      const role = await tx.courseRole.create({
        data: {
          courseId,
          name: input.name,
          nameAr: input.nameAr,
          permissions: input.permissions,
          visibility: input.visibility,
          order: input.order ?? (last._max.order ?? -1) + 1,
        },
      });
      await this.audit.log(
        { actorId: actor.id, action: 'course_role.created', entityType: 'Course', entityId: courseId, metadata: { roleId: role.id, name: role.name, permissions: role.permissions, visibility: role.visibility } },
        tx,
      );
    });
    return this.get(courseId);
  }

  /** Built-in roles too: rename, re-permission, show or hide. Main instructor keeps every permission it is given. */
  async updateRole(courseId: string, roleId: string, input: CourseRoleInput, actor: Actor): Promise<CourseStaffDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`course-roles:${courseId}`}))`;
      const before = await this.role(courseId, roleId, tx);
      await this.nameFree(tx, courseId, input.name, roleId);
      const after = await tx.courseRole.update({
        where: { id: roleId },
        data: { name: input.name, nameAr: input.nameAr, permissions: input.permissions, visibility: input.visibility, ...(input.order !== undefined ? { order: input.order } : {}) },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'course_role.updated',
          entityType: 'Course',
          entityId: courseId,
          metadata: {
            roleId,
            builtin: before.builtin,
            ...(before.name !== after.name ? { name: { from: before.name, to: after.name } } : {}),
            permissions: { from: before.permissions, to: after.permissions },
            ...(before.visibility !== after.visibility ? { visibility: { from: before.visibility, to: after.visibility } } : {}),
          },
        },
        tx,
      );
      await syncCourseInstructors(tx, courseId);
    });
    return this.get(courseId);
  }

  /** Custom roles and the Co-instructor and Moderator roles, once nobody is in them. Main instructor stays. */
  async deleteRole(courseId: string, roleId: string, actor: Actor): Promise<CourseStaffDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`course-roles:${courseId}`}))`;
      const role = await this.role(courseId, roleId, tx);
      if (role.builtin === 'MAIN') throw new BadRequestException({ code: 'MAIN_ROLE', message: 'The Main instructor role can’t be deleted' });
      if (await tx.courseStaff.count({ where: { roleId } })) {
        throw new ConflictException({ code: 'ROLE_HAS_STAFF', message: 'Move or remove the people in this role first' });
      }
      await tx.courseRole.delete({ where: { id: roleId } });
      await this.audit.log({ actorId: actor.id, action: 'course_role.deleted', entityType: 'Course', entityId: courseId, metadata: { roleId, name: role.name, builtin: role.builtin } }, tx);
    });
    return this.get(courseId);
  }

  // ------------------------------------------------------------------ people

  /**
   * Adds an existing account (by email) or a public speaker profile. An account's own speaker
   * profile comes with it (the course page shows it); a profile's account comes with it (it can
   * act). Someone already on the staff: 409 ALREADY_STAFF (change their role instead).
   */
  async add(courseId: string, input: AddCourseStaffInput, actor: Actor): Promise<CourseStaffDto> {
    await this.course(courseId);
    await this.ensureRoles(courseId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`course-staff:${courseId}`}))`;
      const role = await this.role(courseId, input.roleId, tx);
      let userId: string | null = null;
      let instructorId: string | null = null;
      if (input.email) {
        const user = await tx.user.findUnique({ where: { email: input.email.toLowerCase() }, select: { id: true, deletedAt: true, speakerProfile: { select: { id: true } } } });
        if (!user || user.deletedAt) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'No academy account uses this email' });
        userId = user.id;
        instructorId = user.speakerProfile?.id ?? null;
      } else {
        const profile = await tx.instructor.findUnique({ where: { id: input.instructorId! }, select: { id: true, userId: true, user: { select: { deletedAt: true } } } });
        if (!profile) throw new NotFoundException({ code: 'INSTRUCTOR_NOT_FOUND', message: 'Speaker profile not found' });
        instructorId = profile.id;
        userId = profile.userId && !profile.user?.deletedAt ? profile.userId : null;
      }
      const rows = await tx.courseStaff.findMany({
        where: { courseId, OR: [...(userId ? [{ userId }] : []), ...(instructorId ? [{ instructorId }] : [])] },
        select: { id: true, userId: true, instructorId: true },
      });
      // Already there as the person asked for (by account, or by profile when that's what was given).
      if (rows.some((r) => (input.email ? r.userId === userId : r.instructorId === instructorId))) {
        throw new ConflictException({ code: 'ALREADY_STAFF', message: 'This person is already on the course staff. Change their role instead.' });
      }
      const last = await tx.courseStaff.aggregate({ where: { courseId, roleId: role.id }, _max: { order: true } });
      const order = (last._max.order ?? -1) + 1;
      let id: string;
      if (rows.length === 1) {
        // The other half is already there (their profile shown, or their account acting): one row for both.
        const r = rows[0]!;
        id = (await tx.courseStaff.update({ where: { id: r.id }, data: { userId: r.userId ?? userId, instructorId: r.instructorId ?? instructorId, roleId: role.id } })).id;
      } else if (rows.length > 1) {
        throw new ConflictException({ code: 'ALREADY_STAFF', message: 'This person is already on the course staff. Change their role instead.' });
      } else {
        id = (await tx.courseStaff.create({ data: { courseId, roleId: role.id, userId, instructorId, order } })).id;
      }
      await this.audit.log(
        { actorId: actor.id, action: 'course_staff.added', entityType: 'Course', entityId: courseId, metadata: { staffId: id, roleId: role.id, role: role.name, userId, instructorId } },
        tx,
      );
      await syncCourseInstructors(tx, courseId);
    });
    return this.get(courseId);
  }

  async update(courseId: string, staffId: string, input: UpdateCourseStaffInput, actor: Actor): Promise<CourseStaffDto> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.courseStaff.findFirst({ where: { id: staffId, courseId }, include: { role: { select: { name: true } } } });
      if (!row) throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Not on this course’s staff' });
      const role = await this.role(courseId, input.roleId, tx);
      await tx.courseStaff.update({ where: { id: staffId }, data: { roleId: role.id, ...(input.order !== undefined ? { order: input.order } : {}) } });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'course_staff.updated',
          entityType: 'Course',
          entityId: courseId,
          metadata: { staffId, userId: row.userId, instructorId: row.instructorId, role: { from: row.role.name, to: role.name }, ...(input.order !== undefined ? { order: input.order } : {}) },
        },
        tx,
      );
      await syncCourseInstructors(tx, courseId);
    });
    return this.get(courseId);
  }

  async remove(courseId: string, staffId: string, actor: Actor): Promise<CourseStaffDto> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.courseStaff.findFirst({ where: { id: staffId, courseId }, include: { role: { select: { name: true } } } });
      if (!row) throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Not on this course’s staff' });
      await tx.courseStaff.delete({ where: { id: staffId } });
      await this.audit.log(
        { actorId: actor.id, action: 'course_staff.removed', entityType: 'Course', entityId: courseId, metadata: { staffId, userId: row.userId, instructorId: row.instructorId, role: row.role.name } },
        tx,
      );
      await syncCourseInstructors(tx, courseId);
    });
    return this.get(courseId);
  }

  // ------------------------------------------------------------------ public course page

  /**
   * SHOWN roles only, Main instructor first, then by role order; people by their order. A
   * person shows their public speaker profile (name, title, photo, bio), else their account's
   * name only. Never an email, never anyone in an ANONYMOUS role, never a deleted account.
   */
  async publicGroups(courseId: string): Promise<PublicStaffGroupDto[]> {
    const roles = await this.prisma.courseRole.findMany({
      where: { courseId, visibility: 'SHOWN' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        nameAr: true,
        builtin: true,
        staff: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            instructor: { select: { name: true, nameAr: true, titleEn: true, titleAr: true, bioEn: true, bioAr: true, photoUrl: true, slug: true, linkedinUrl: true } },
            user: { select: { deletedAt: true, anonymizedAt: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } },
          },
        },
      },
    });
    roles.sort((a, b) => Number(b.builtin === 'MAIN') - Number(a.builtin === 'MAIN'));
    return roles
      .map((r) => ({
        roleId: r.id,
        name: r.name,
        nameAr: r.nameAr,
        builtin: r.builtin,
        people: r.staff.flatMap((s) => {
          const i = s.instructor;
          if (i) {
            return [{ id: s.id, name: i.name, nameAr: i.nameAr, titleEn: i.titleEn || null, titleAr: i.titleAr, bioEn: i.bioEn || null, bioAr: i.bioAr, photoUrl: i.photoUrl, slug: i.slug, linkedinUrl: i.linkedinUrl }];
          }
          const u = s.user;
          const name = u && !u.deletedAt && !u.anonymizedAt ? u.profile?.fullNameEn?.trim() : '';
          if (!name) return [];
          return [{ id: s.id, name, nameAr: u?.profile?.fullNameAr?.trim() || null, titleEn: null, titleAr: null, bioEn: null, bioAr: null, photoUrl: null, slug: null, linkedinUrl: null }];
        }),
      }))
      .filter((g) => g.people.length > 0);
  }
}
