import { LEARNER_ROLES } from '@academy/shared';
import type { Prisma } from '@prisma/client';

/**
 * Role filter for course-scoped queries (an enrolment, an application): students and speakers
 * who study count as students; admins trying the flows on their own account never do.
 */
export const LEARNER_ROLE_FILTER = { in: [...LEARNER_ROLES] } satisfies Prisma.EnumRoleFilter;

/**
 * Accounts with a student side, for queries not tied to one course: every student, and the
 * speakers who applied to or enrolled in a course (other speakers never used the student flows).
 */
export const LEARNER_USER = {
  OR: [
    { role: 'STUDENT' },
    { role: 'SPEAKER', OR: [{ applications: { some: {} } }, { enrollments: { some: {} } }] },
  ],
} satisfies Prisma.UserWhereInput;
