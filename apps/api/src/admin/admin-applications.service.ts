import { Injectable, NotFoundException } from '@nestjs/common';
import {

  availableAdminEvents,
  SEAT_HOLDING_STATUSES,
  toCsv,
  type AdminApplicationEvent,
  type ApplicationFilter,
  type QuestionOption,
} from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { ApplicationWorkflow, type Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { toProfileDto } from '../users/profile.service';
import { capRows, EXPORT_LIMIT } from './export';
import { hasProfileFilter, profileWhere, userSearch } from './profile-filter';

@Injectable()
export class AdminApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApplicationWorkflow,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  where(f: ApplicationFilter): Prisma.ApplicationWhereInput {
    // Accounts pending deletion are out of every admin list and export.
    const user: Prisma.UserWhereInput = {
      deletedAt: null,
      ...userSearch(f.q),
      ...(hasProfileFilter(f) ? { profile: profileWhere(f) } : {}),
    };
    return {
      ...(f.courseId ? { courseId: f.courseId } : {}),
      ...(f.status?.length ? { status: { in: f.status } } : {}),
      ...(f.ref ? { ref: { contains: f.ref, mode: 'insensitive' } } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
      user,
    };
  }

  private orderBy(sort: ApplicationFilter['sort']): Prisma.ApplicationOrderByWithRelationInput[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }];
      case 'name':
        return [{ user: { profile: { fullNameEn: 'asc' } } }, { createdAt: 'desc' }];
      case 'experience':
        // Enum order in Postgres follows declaration order (Y0_1 < … < Y10_PLUS).
        return [{ user: { profile: { experienceYears: { sort: 'desc', nulls: 'last' } } } }, { createdAt: 'desc' }];
      default:
        return [{ createdAt: 'desc' }];
    }
  }

  async list(f: ApplicationFilter) {
    const where = this.where(f);
    const [total, rows] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({
        where,
        orderBy: this.orderBy(f.sort),
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        include: {
          course: { select: { id: true, slug: true, titleEn: true, titleAr: true, type: true, capacity: true } },
          user: { select: { id: true, email: true, profile: true } },
        },
      }),
    ]);
    const seats = await this.seats([...new Set(rows.map((r) => r.courseId))]);
    return {
      total,
      page: f.page,
      pageSize: f.pageSize,
      items: rows.map((a) => {
        const taken = (seats.get(a.courseId) ?? 0) - ((SEAT_HOLDING_STATUSES as readonly string[]).includes(a.status) ? 1 : 0);
        return {
          id: a.id,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
          ref: a.ref,
          course: { id: a.course.id, slug: a.course.slug, titleEn: a.course.titleEn, titleAr: a.course.titleAr, type: a.course.type },
          student: {
            id: a.user.id,
            email: a.user.email,
            name: a.user.profile?.fullNameEn ?? null,
            country: a.user.profile?.country ?? null,
            jobTitle: a.user.profile?.jobTitle ?? null,
            experienceYears: a.user.profile?.experienceYears ?? null,
            seniority: a.user.profile?.seniority ?? null,
            primaryArea: a.user.profile?.primaryArea ?? null,
          },
          availableEvents: availableAdminEvents(a.status, { courseType: a.course.type, capacity: a.course.capacity, seatsTaken: taken }),
        };
      }),
    };
  }

  private async seats(courseIds: string[]): Promise<Map<string, number>> {
    if (!courseIds.length) return new Map();
    const rows = await this.prisma.application.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds }, status: { in: [...SEAT_HOLDING_STATUSES] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.courseId, r._count._all]));
  }

  async detail(id: string) {
    const a = await this.prisma.application.findUnique({
      where: { id },
      include: {
        course: { include: { screeningQuestions: { orderBy: { order: 'asc' } } } },
        user: { include: { profile: { include: { skills: true } } } },
        history: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { email: true } } } },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { email: true } } } },
        payments: { orderBy: { createdAt: 'desc' }, select: { id: true } },
      },
    });
    if (!a) throw new NotFoundException('Application not found');
    const seats = await this.seats([a.courseId]);
    const taken = (seats.get(a.courseId) ?? 0) - ((SEAT_HOLDING_STATUSES as readonly string[]).includes(a.status) ? 1 : 0);
    return {
      id: a.id,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      source: a.source,
      rejectionReason: a.rejectionReason,
      course: { id: a.course.id, slug: a.course.slug, titleEn: a.course.titleEn, titleAr: a.course.titleAr, type: a.course.type },
      questions: a.course.screeningQuestions.map((q) => ({
        id: q.id,
        labelEn: q.labelEn,
        labelAr: q.labelAr,
        type: q.type,
        options: q.options as QuestionOption[] | null,
      })),
      answers: a.answers,
      /** What the applicant had when applying. */
      profileSnapshot: a.profileSnapshot,
      /** Their profile today (filters use this one). */
      currentProfile: toProfileDto(a.user.profile),
      student: { id: a.user.id, email: a.user.email, emailVerified: Boolean(a.user.emailVerifiedAt), deleted: Boolean(a.user.deletedAt) },
      history: a.history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        actor: h.actor?.email ?? null,
        createdAt: h.createdAt.toISOString(),
      })),
      notes: a.notes.map((n) => ({ id: n.id, body: n.body, author: n.author?.email ?? null, createdAt: n.createdAt.toISOString() })),
      payments: await Promise.all(a.payments.map((p) => this.payments.adminGet(p.id))),
      availableEvents: availableAdminEvents(a.status, { courseType: a.course.type, capacity: a.course.capacity, seatsTaken: taken }),
    };
  }

  async bulk(ids: string[], event: AdminApplicationEvent, admin: Actor, reason?: string) {
    const results: { id: string; ok: boolean; status?: string; error?: string }[] = [];
    // Sequential on purpose: each transition locks its course row; parallel calls would just queue.
    for (const id of [...new Set(ids)]) {
      try {
        const app = await this.workflow.transition(id, event, admin, { reason: event === 'REJECT' ? reason : undefined, awaitSideEffects: false });
        results.push({ id, ok: true, status: app.status });
      } catch (err) {
        const e = err as { response?: { message?: string }; message?: string };
        results.push({ id, ok: false, error: e.response?.message ?? e.message ?? 'Failed' });
      }
    }
    return { results, succeeded: results.filter((r) => r.ok).length };
  }

  async addNote(applicationId: string, admin: Actor, body: string) {
    const a = await this.prisma.application.findUnique({ where: { id: applicationId }, select: { userId: true } });
    if (!a) throw new NotFoundException('Application not found');
    const note = await this.prisma.adminNote.create({
      data: { applicationId, subjectUserId: a.userId, authorId: admin.id, body },
      include: { author: { select: { email: true } } },
    });
    return { id: note.id, body: note.body, author: note.author?.email ?? null, createdAt: note.createdAt.toISOString() };
  }

  /** CSV of the filtered view. Exports are personal data, so each one is audited. */
  async exportCsv(f: ApplicationFilter, admin: Actor): Promise<string> {
    const rows = await this.prisma.application.findMany({
      where: this.where(f),
      orderBy: this.orderBy(f.sort),
      take: EXPORT_LIMIT + 1,
      include: {
        course: { select: { titleEn: true } },
        user: { include: { profile: { include: { skills: true } } } },
      },
    });
    const questions = f.courseId
      ? await this.prisma.screeningQuestion.findMany({ where: { courseId: f.courseId }, orderBy: { order: 'asc' } })
      : [];
    const header = [
      'Application ID', 'Applied at', 'Status', 'Course', 'Ref', 'UTM source', 'Name (EN)', 'Name (AR)', 'Email', 'Phone',
      'Country', 'City', 'Employment', 'Job title', 'Company', 'Experience', 'ML experience', 'Seniority', 'Primary area',
      'Secondary areas', 'Education', 'Skills (1-5)', 'Cloud', 'Weekly hours', 'Topics', 'Open to opportunities',
      'Share with partners', 'Google email', 'LinkedIn', 'GitHub',
      ...questions.map((q) => `Q: ${q.labelEn}`),
    ];
    const body = capRows(rows, (a) => {
      const p = a.user.profile;
      const answers = (a.answers ?? {}) as Record<string, unknown>;
      const src = (a.source ?? {}) as Record<string, string>;
      return [
        a.id, a.createdAt.toISOString(), a.status, a.course.titleEn, a.ref, src.utm_source, p?.fullNameEn, p?.fullNameAr, a.user.email,
        p?.phone, p?.country, p?.city, p?.employmentStatus, p?.jobTitle, p?.company, p?.experienceYears, p?.mlExperienceYears,
        p?.seniority, p?.primaryArea, p?.secondaryAreas, p?.educationLevel,
        (p?.skills ?? []).map((s) => `${s.skill}:${s.level}`), p?.cloudPlatforms, p?.weeklyHours, p?.interestedTopics,
        p?.openToOpportunities, p?.shareWithPartners, p?.googleEmail, p?.linkedinUrl, p?.githubUrl,
        ...questions.map((q) => answers[q.id]),
      ];
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'applications.exported',
      entityType: 'Application',
      metadata: { count: Math.min(rows.length, EXPORT_LIMIT), courseId: f.courseId ?? null, statuses: f.status ?? null },
    });
    return toCsv(header, body);
  }
}


