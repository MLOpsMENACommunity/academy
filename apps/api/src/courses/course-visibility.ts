import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Private courses (Course.visibleToEmails). An empty list is a normal public course; a private
 * one is shown only to a signed-in account whose confirmed email is in the list (and to admins
 * in Admin). Every public listing (catalog, slugs/sitemap, speaker pages, recordings) uses
 * PUBLIC_LISTING, so a private course never appears there, not even for the accounts it is for
 * (they find it on their dashboard: GET /me/private-courses).
 */
export const PUBLIC_LISTING = { visibleToEmails: { isEmpty: true } } satisfies Prisma.CourseWhereInput;

/**
 * The viewer's email for the visibility check: lower-cased, and only once the account has
 * confirmed it (an unconfirmed sign-up with someone else's address must not see their course).
 * Null when anonymous, unconfirmed or deleted.
 */
export async function viewerEmail(prisma: Pick<PrismaService, 'user'>, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, deletedAt: true } });
  if (!u || !u.emailVerifiedAt || u.deletedAt) return null;
  return u.email.trim().toLowerCase();
}

/** Courses this viewer may see: public ones, plus private ones that list their confirmed email. */
export function visibleToWhere(email: string | null): Prisma.CourseWhereInput {
  return email ? { OR: [PUBLIC_LISTING, { visibleToEmails: { has: email } }] } : PUBLIC_LISTING;
}

/**
 * Write paths that take a course from a student (applying, the waiting list): a private course
 * is "not found" for anyone not on its list, exactly like the course page.
 */
export async function assertCourseVisible(
  prisma: Pick<PrismaService, 'user'>,
  course: { visibleToEmails: readonly string[] },
  userId: string,
): Promise<void> {
  if (!course.visibleToEmails.length) return;
  const email = await viewerEmail(prisma, userId);
  if (!email || !course.visibleToEmails.includes(email)) throw new NotFoundException('Course not found');
}
