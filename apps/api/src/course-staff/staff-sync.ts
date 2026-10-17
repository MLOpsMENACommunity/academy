import { BUILTIN_COURSE_ROLES, BUILTIN_ROLE_DEFAULTS, type BuiltinCourseRole } from '@academy/shared';
import type { Prisma } from '@prisma/client';

/**
 * Course staff writes shared by the API, the seed and the archive import (no Nest here).
 *
 * Source of truth: CourseStaff (+ CourseRole). CourseInstructor is derived from it by
 * syncCourseInstructors after every staff change, for the readers that still use it (catalog
 * cards, certificates, the speaker pages' course counts): the people in the Main instructor and
 * Co-instructor roles who have a public speaker profile, while their role is SHOWN, in order.
 */

type Tx = Prisma.TransactionClient;

/**
 * Creates whichever of these built-in roles the course doesn't have yet (default: all three, for
 * a new course). Idempotent. Co-instructor and Moderator can be deleted later, so after creation
 * only what is needed is ensured (Main instructor always; Co-instructor when someone joins as one).
 */
export async function ensureBuiltinRoles(tx: Tx, courseId: string, which: readonly BuiltinCourseRole[] = BUILTIN_COURSE_ROLES): Promise<void> {
  const have = await tx.courseRole.findMany({ where: { courseId, builtin: { not: null } }, select: { builtin: true } });
  const missing = which.filter((b) => !have.some((h) => h.builtin === b));
  if (!missing.length) return;
  await tx.courseRole.createMany({
    data: missing.map((b) => {
      const d = BUILTIN_ROLE_DEFAULTS[b];
      return { courseId, builtin: b, name: d.name, nameAr: d.nameAr, permissions: [...d.permissions], visibility: d.visibility, order: d.order };
    }),
    // Two requests at once: the unique (courseId, builtin) keeps one of each.
    skipDuplicates: true,
  });
}

/** Rewrites CourseInstructor from CourseStaff (see above). */
export async function syncCourseInstructors(tx: Tx, courseId: string): Promise<void> {
  const rows = await tx.courseStaff.findMany({
    where: { courseId, instructorId: { not: null }, role: { builtin: { in: ['MAIN', 'CO'] }, visibility: 'SHOWN' } },
    select: { instructorId: true, order: true, role: { select: { order: true } } },
  });
  rows.sort((a, b) => a.role.order - b.role.order || a.order - b.order);
  await tx.courseInstructor.deleteMany({ where: { courseId } });
  if (rows.length) {
    await tx.courseInstructor.createMany({ data: rows.map((r, order) => ({ courseId, instructorId: r.instructorId!, order })) });
  }
}

/**
 * The course editor's "Instructors" field, the archive import and the seed: the given public
 * speaker profiles, in order, are the course's instructors. Each one already on the staff keeps
 * their role (only the order changes); a new one becomes the Main instructor when the course has
 * none yet, else a Co-instructor. Main instructors and Co-instructors with a profile who aren't in
 * the list leave the staff (as removing a speaker from a course always did), their account
 * included. Moderators, custom roles and staff without a profile are never touched here: they
 * are managed in the Staff tab.
 */
export async function setCourseInstructors(tx: Tx, courseId: string, instructorIds: readonly string[]): Promise<void> {
  const ids = [...new Set(instructorIds)];
  // A course that has no roles at all yet (just created) gets all three; otherwise only what this needs.
  const fresh = (await tx.courseRole.count({ where: { courseId } })) === 0;
  await ensureBuiltinRoles(tx, courseId, fresh ? BUILTIN_COURSE_ROLES : ids.length > 1 ? ['MAIN', 'CO'] : ['MAIN']);
  const roles = await tx.courseRole.findMany({ where: { courseId, builtin: { in: ['MAIN', 'CO'] } }, select: { id: true, builtin: true } });
  const main = roles.find((r) => r.builtin === 'MAIN')!.id;
  let co = roles.find((r) => r.builtin === 'CO')?.id ?? null;

  await tx.courseStaff.deleteMany({ where: { courseId, roleId: { in: co ? [main, co] : [main] }, instructorId: { not: null, notIn: ids } } });

  const existing = await tx.courseStaff.findMany({ where: { courseId }, select: { id: true, roleId: true, userId: true, instructorId: true } });
  const profiles = await tx.instructor.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true } });
  let hasMain = existing.some((s) => s.roleId === main);
  for (const [order, instructorId] of ids.entries()) {
    const profile = profiles.find((p) => p.id === instructorId);
    if (!profile) continue;
    const mine = existing.find((s) => s.instructorId === instructorId);
    if (mine) {
      await tx.courseStaff.update({ where: { id: mine.id }, data: { order } });
      continue;
    }
    // The speaker account behind the profile may already be on the staff on its own: link it.
    const byAccount = profile.userId ? existing.find((s) => s.userId === profile.userId) : undefined;
    if (byAccount) {
      await tx.courseStaff.update({ where: { id: byAccount.id }, data: { instructorId, order } });
      byAccount.instructorId = instructorId;
      continue;
    }
    if (hasMain && !co) {
      await ensureBuiltinRoles(tx, courseId, ['CO']);
      co = (await tx.courseRole.findFirstOrThrow({ where: { courseId, builtin: 'CO' }, select: { id: true } })).id;
    }
    const roleId = hasMain ? co! : main;
    hasMain = true;
    const created = await tx.courseStaff.create({ data: { courseId, roleId, instructorId, userId: profile.userId, order } });
    existing.push({ id: created.id, roleId, userId: profile.userId, instructorId });
  }
  await syncCourseInstructors(tx, courseId);
}

/**
 * A public speaker profile was just linked to an account (speaker application approved): its
 * display-only staff rows now act as that account, unless the account is already on that
 * course's staff by itself.
 */
export async function linkProfileStaffToAccount(tx: Tx, instructorId: string, userId: string): Promise<void> {
  const rows = await tx.courseStaff.findMany({ where: { instructorId, userId: null }, select: { id: true, courseId: true } });
  for (const r of rows) {
    const taken = await tx.courseStaff.count({ where: { courseId: r.courseId, userId } });
    if (!taken) await tx.courseStaff.update({ where: { id: r.id }, data: { userId } });
  }
}

/** Duplicate a course: the new one gets the same roles (names, permissions, visibility) and people. */
export async function copyStaff(tx: Tx, fromCourseId: string, toCourseId: string): Promise<void> {
  const roles = await tx.courseRole.findMany({ where: { courseId: fromCourseId }, include: { staff: true } });
  for (const r of roles) {
    const role = await tx.courseRole.create({
      data: { courseId: toCourseId, name: r.name, nameAr: r.nameAr, permissions: r.permissions, visibility: r.visibility, builtin: r.builtin, order: r.order },
    });
    if (r.staff.length) {
      await tx.courseStaff.createMany({
        data: r.staff.map((s) => ({ courseId: toCourseId, roleId: role.id, userId: s.userId, instructorId: s.instructorId, order: s.order })),
      });
    }
  }
  await ensureBuiltinRoles(tx, toCourseId, (await tx.courseRole.count({ where: { courseId: toCourseId } })) ? ['MAIN'] : undefined);
  await syncCourseInstructors(tx, toCourseId);
}
