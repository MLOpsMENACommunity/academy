import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminReviewDto, AdminReviewsQuery, AdminTestimonialDto, TestimonialInput, TestimonialReviewInput } from '@academy/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { PublicDataChanges } from '../common/public-data';
import { PrismaService } from '../prisma/prisma.service';
import { reviewEligibility } from './eligibility';

/** How many reviews Admin → Reviews lists at once (the oldest to review first). */
const ADMIN_REVIEWS_MAX = 200;

const authorSelect = { email: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } as const;

type Row = {
  id: string;
  body: string;
  rating: number | null;
  status: AdminTestimonialDto['status'];
  consentAt: Date;
  updatedAt: Date;
  user: { email: string; profile: { fullNameEn: string | null; fullNameAr: string | null } | null };
};

const toAdmin = (r: Row): AdminTestimonialDto => ({
  id: r.id,
  name: r.user.profile?.fullNameEn || r.user.profile?.fullNameAr || null,
  email: r.user.email,
  body: r.body,
  rating: r.rating,
  status: r.status,
  consentAt: r.consentAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * Students' reviews of a course: star ratings and/or testimonials. Only a student who finished the
 * course may write one (see reviewEligibility). Nothing is public, and no rating counts, until an
 * admin approves it; changing an approved review takes it down again until it is reviewed.
 */
@Injectable()
export class TestimonialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly publicData: PublicDataChanges,
  ) {}

  /** The course, if this student is really enrolled in it (admin previews can't write). */
  private async enrolledCourse(user: AuthUser, slug: string) {
    const course = await this.prisma.course.findUnique({ where: { slug }, select: { id: true, selfPaced: true, status: true, endDate: true } });
    if (!course) throw new NotFoundException('Course not found');
    const eligibility = await reviewEligibility(this.prisma, user.id, course);
    if (!eligibility.enrolled) throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    return { course, canReview: eligibility.canReview };
  }

  async save(user: AuthUser, slug: string, input: TestimonialInput): Promise<void> {
    const { course, canReview } = await this.enrolledCourse(user, slug);
    if (!canReview) throw new ConflictException({ code: 'REVIEW_NOT_FINISHED', message: 'You can review this course once you have finished it' });
    const key = { userId_courseId: { userId: user.id, courseId: course.id } };
    const before = await this.prisma.testimonial.findUnique({ where: key, select: { status: true } });
    const data = { body: input.body, rating: input.rating, status: 'PENDING' as const, consentAt: new Date(), reviewedAt: null, reviewedById: null };
    await this.prisma.testimonial.upsert({ where: key, update: data, create: { ...data, userId: user.id, courseId: course.id } });
    if (before?.status === 'APPROVED') this.publicData.changed();
  }

  /** Withdraws consent: the review is gone, from the site too. */
  async remove(user: AuthUser, slug: string): Promise<void> {
    const { course } = await this.enrolledCourse(user, slug);
    const where = { userId: user.id, courseId: course.id };
    const wasPublic = await this.prisma.testimonial.count({ where: { ...where, status: 'APPROVED' } });
    await this.prisma.testimonial.deleteMany({ where });
    if (wasPublic) this.publicData.changed();
  }

  async list(courseId: string): Promise<AdminTestimonialDto[]> {
    const rows = await this.prisma.testimonial.findMany({
      where: { courseId, user: { deletedAt: null } },
      orderBy: { updatedAt: 'desc' },
      include: { user: { select: authorSelect } },
    });
    return rows.map(toAdmin);
  }

  /** Admin → Reviews: every course's reviews with one status; the longest waiting first. */
  async listAll(q: AdminReviewsQuery): Promise<AdminReviewDto[]> {
    const rows = await this.prisma.testimonial.findMany({
      where: { status: q.status, user: { deletedAt: null } },
      orderBy: q.status === 'PENDING' ? { updatedAt: 'asc' } : { updatedAt: 'desc' },
      take: ADMIN_REVIEWS_MAX,
      include: { user: { select: authorSelect }, course: { select: { id: true, slug: true, titleEn: true, titleAr: true } } },
    });
    return rows.map((r) => ({ ...toAdmin(r), courseId: r.course.id, courseSlug: r.course.slug, courseTitleEn: r.course.titleEn, courseTitleAr: r.course.titleAr }));
  }

  async review(courseId: string, id: string, input: TestimonialReviewInput, adminId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.testimonial.updateMany({ where: { id, courseId }, data: { status: input.status, reviewedAt: new Date(), reviewedById: adminId } });
      if (!count) throw new NotFoundException('Testimonial not found');
      await this.audit.log({ actorId: adminId, action: 'testimonial.reviewed', entityType: 'Testimonial', entityId: id, metadata: { courseId, status: input.status } }, tx);
    });
    this.publicData.changed();
  }
}
