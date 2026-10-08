import { Injectable, NotFoundException } from '@nestjs/common';
import { toCsv, type StudentFilter } from '@academy/shared';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SIGNED_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import { toProfileDto } from '../users/profile.service';
import { capRows, EXPORT_LIMIT } from './export';
import { hasProfileFilter, profileWhere, userSearch } from './profile-filter';

/** All registered students (not only applicants): find people for future courses. Read-only. */
@Injectable()
export class AdminStudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  where(f: StudentFilter): Prisma.UserWhereInput {
    return {
      role: 'STUDENT',
      deletedAt: null,
      ...userSearch(f.q),
      ...(hasProfileFilter(f) ? { profile: profileWhere(f) } : {}),
    };
  }

  private orderBy(sort: StudentFilter['sort']): Prisma.UserOrderByWithRelationInput[] {
    if (sort === 'oldest') return [{ createdAt: 'asc' }];
    if (sort === 'name') return [{ profile: { fullNameEn: 'asc' } }];
    if (sort === 'experience') return [{ profile: { experienceYears: { sort: 'desc', nulls: 'last' } } }];
    return [{ createdAt: 'desc' }];
  }

  async list(f: StudentFilter) {
    const where = this.where(f);
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: this.orderBy(f.sort),
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        include: { profile: true, _count: { select: { applications: true, enrollments: true } } },
      }),
    ]);
    return {
      total,
      page: f.page,
      pageSize: f.pageSize,
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.profile?.fullNameEn ?? null,
        country: u.profile?.country ?? null,
        jobTitle: u.profile?.jobTitle ?? null,
        experienceYears: u.profile?.experienceYears ?? null,
        seniority: u.profile?.seniority ?? null,
        primaryArea: u.profile?.primaryArea ?? null,
        completeness: u.profile?.completeness ?? 0,
        openToOpportunities: u.profile?.openToOpportunities ?? false,
        applications: u._count.applications,
        enrollments: u._count.enrollments,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  }

  async detail(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        profile: { include: { skills: true } },
        applications: { orderBy: { createdAt: 'desc' }, include: { course: { select: { titleEn: true, titleAr: true, slug: true } } } },
        enrollments: { include: { course: { select: { titleEn: true, titleAr: true } } } },
        adminNotesAbout: { orderBy: { createdAt: 'desc' }, include: { author: { select: { email: true } } } },
      },
    });
    if (!u) throw new NotFoundException('Student not found');
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      emailVerified: Boolean(u.emailVerifiedAt),
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      profile: toProfileDto(u.profile),
      applications: u.applications.map((a) => ({
        id: a.id,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        course: a.course,
      })),
      enrollments: u.enrollments.map((e) => ({ id: e.id, course: e.course, enrolledAt: e.enrolledAt.toISOString() })),
      notes: u.adminNotesAbout.map((n) => ({
        id: n.id,
        body: n.body,
        applicationId: n.applicationId,
        author: n.author?.email ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  /** CVs: private, admin-only, 5-minute link, every view audited (Risk 3 applies to CVs too). */
  async cvUrl(userId: string, admin: Actor) {
    // Not for accounts pending deletion: their data is on its way out.
    const p = await this.prisma.profile.findFirst({ where: { userId, user: { deletedAt: null } }, select: { cvKey: true } });
    if (!p?.cvKey) throw new NotFoundException('No CV');
    await this.audit.log({ actorId: admin.id, action: 'profile.cv_viewed', entityType: 'User', entityId: userId });
    return { url: await this.storage.signedUrl(p.cvKey), expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  async addNote(userId: string, admin: Actor, body: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new NotFoundException('Student not found');
    const n = await this.prisma.adminNote.create({
      data: { subjectUserId: userId, authorId: admin.id, body },
      include: { author: { select: { email: true } } },
    });
    return { id: n.id, body: n.body, applicationId: null, author: n.author?.email ?? null, createdAt: n.createdAt.toISOString() };
  }

  async exportCsv(f: StudentFilter, admin: Actor): Promise<string> {
    const users = await this.prisma.user.findMany({
      where: this.where(f),
      orderBy: this.orderBy(f.sort),
      take: EXPORT_LIMIT + 1,
      include: { profile: { include: { skills: true } } },
    });
    const header = [
      'Student ID', 'Registered', 'Name (EN)', 'Name (AR)', 'Email', 'Phone', 'Country', 'City', 'Employment', 'Job title', 'Company',
      'Industry', 'Experience', 'ML experience', 'Seniority', 'Primary area', 'Secondary areas', 'Education', 'Field of study', 'Institution', 'Skills (1-5)', 'Cloud',
      'Tools', 'Goals', 'Topics', 'Weekly hours', 'Preferred times', 'Format', 'Open to opportunities', 'Share with partners',
      'Marketing emails', 'LinkedIn', 'GitHub', 'Completeness %',
    ];
    const rows = capRows(users, (u) => {
      const p = u.profile;
      return [
        u.id, u.createdAt.toISOString(), p?.fullNameEn, p?.fullNameAr, u.email, p?.phone, p?.country, p?.city, p?.employmentStatus,
        p?.jobTitle, p?.company, p?.industry, p?.experienceYears, p?.mlExperienceYears, p?.seniority, p?.primaryArea, p?.secondaryAreas,
        p?.educationLevel, p?.fieldOfStudy, p?.university, (p?.skills ?? []).map((s) => `${s.skill}:${s.level}`), p?.cloudPlatforms, p?.productionTools,
        p?.learningGoals, p?.interestedTopics, p?.weeklyHours, p?.preferredTimes, p?.preferredFormat, p?.openToOpportunities,
        p?.shareWithPartners, p?.marketingEmails, p?.linkedinUrl, p?.githubUrl, p?.completeness,
      ];
    });
    await this.audit.log({ actorId: admin.id, action: 'students.exported', entityType: 'User', metadata: { count: Math.min(users.length, EXPORT_LIMIT) } });
    return toCsv(header, rows);
  }
}
