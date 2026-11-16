import { canReviewCourse } from '@academy/shared';
import type { Course, Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/**
 * May this student rate and review the course? Enrolled and finished (shared canReviewCourse):
 * a valid (not revoked) certificate for it, or the course is over. Used by the learn page and the
 * write, so the form and the API always agree.
 */
export async function reviewEligibility(
  db: Db,
  userId: string,
  course: Pick<Course, 'id' | 'selfPaced' | 'status' | 'endDate'>,
  now = new Date(),
): Promise<{ enrolled: boolean; canReview: boolean }> {
  const enrollment = await db.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId: course.id } },
    select: { certificate: { select: { revokedAt: true } } },
  });
  const enrolled = Boolean(enrollment);
  const hasCertificate = Boolean(enrollment?.certificate && !enrollment.certificate.revokedAt);
  return { enrolled, canReview: canReviewCourse({ enrolled, selfPaced: course.selfPaced, hasCertificate, status: course.status, endDate: course.endDate }, now) };
}
