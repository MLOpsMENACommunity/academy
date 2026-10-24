import { ATTENDED_STATUSES, completedSessions } from '@academy/shared';
import type { Prisma } from '@prisma/client';

/**
 * Sessions of a course each student completed: attended (Present or Partial), or marked done by
 * the student before that box was retired. Used by the learn page, certificates, the roster and
 * "Finisher", so they all count the same way.
 */
export async function completedSessionsBy(db: Prisma.TransactionClient, courseId: string, userIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!userIds.length) return out;
  const where = { userId: { in: userIds }, session: { courseId } };
  const [attended, marked] = await Promise.all([
    db.sessionAttendance.findMany({ where: { ...where, status: { in: [...ATTENDED_STATUSES] } }, select: { userId: true, sessionId: true } }),
    db.sessionProgress.findMany({ where, select: { userId: true, sessionId: true } }),
  ]);
  for (const id of userIds) {
    out.set(
      id,
      completedSessions(
        attended.filter((a) => a.userId === id).map((a) => a.sessionId),
        marked.filter((m) => m.userId === id).map((m) => m.sessionId),
      ),
    );
  }
  return out;
}
