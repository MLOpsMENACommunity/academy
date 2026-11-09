import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminTestimonialDto, TestimonialInput, TestimonialReviewInput } from '@academy/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { PublicDataChanges } from '../common/public-data';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Students' testimonials on self-paced courses. Nothing is public until an admin approves it, and
 * changing an approved testimonial takes it down again until it is reviewed.
 */
@Injectable()
export class TestimonialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly publicData: PublicDataChanges,
  ) {}

  /** The course, if this student is really enrolled in it (admin previews can't write). */
  private async enrolledCourse(user: AuthUser, slug: string): Promise<{ id: string; selfPaced: boolean }> {
    const course = await this.prisma.course.findUnique({ where: { slug }, select: { id: true, selfPaced: true } });
    if (!course) throw new NotFoundException('Course not found');
    const enrollment = await this.prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } }, select: { id: true } });
    if (!enrollment) throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    return course;
  }

  async save(user: AuthUser, slug: string, input: TestimonialInput): Promise<void> {
    const course = await this.enrolledCourse(user, slug);
    if (!course.selfPaced) throw new ConflictException({ code: 'NOT_SELF_PACED', message: 'Testimonials are for self-paced courses' });
    const key = { userId_courseId: { userId: user.id, courseId: course.id } };
    const before = await this.prisma.testimonial.findUnique({ where: key, select: { status: true } });
    const data = { body: input.body, status: 'PENDING' as const, consentAt: new Date(), reviewedAt: null, reviewedById: null };
    await this.prisma.testimonial.upsert({ where: key, update: data, create: { ...data, userId: user.id, courseId: course.id } });
    if (before?.status === 'APPROVED') this.publicData.changed();
  }

  /** Withdraws consent: the testimonial is gone, from the site too. */
  async remove(user: AuthUser, slug: string): Promise<void> {
    const course = await this.enrolledCourse(user, slug);
    const where = { userId: user.id, courseId: course.id };
    const wasPublic = await this.prisma.testimonial.count({ where: { ...where, status: 'APPROVED' } });
    await this.prisma.testimonial.deleteMany({ where });
    if (wasPublic) this.publicData.changed();
  }

  async list(courseId: string): Promise<AdminTestimonialDto[]> {
    const rows = await this.prisma.testimonial.findMany({
      where: { courseId, user: { deletedAt: null } },
      orderBy: { updatedAt: 'desc' },
      include: { user: { select: { email: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.user.profile?.fullNameEn || r.user.profile?.fullNameAr || null,
      email: r.user.email,
      body: r.body,
      status: r.status,
      consentAt: r.consentAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
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
