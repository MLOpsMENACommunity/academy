import { Injectable } from '@nestjs/common';
import { summarizeTalents, TALENT_LIMIT, type Skill, type TalentFilter, type TalentInsightsDto, type TalentRow } from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { LEARNER_USER } from '../common/learners';
import { PrismaService } from '../prisma/prisma.service';
import { hasProfileFilter, profileWhere, userSearch } from './profile-filter';

/** Admin → Talents: what our students can do, for outsourcing. Read-only figures; the maths is summarizeTalents(). */
@Injectable()
export class AdminTalentsService {
  constructor(private readonly prisma: PrismaService) {}

  where(f: TalentFilter): Prisma.UserWhereInput {
    const population: Prisma.UserWhereInput =
      f.population === 'applicants'
        ? { applications: { some: {} } }
        : f.population === 'enrolled'
          ? { enrollments: { some: {} } }
          : f.population === 'certified'
            ? { enrollments: { some: { certificate: { is: { revokedAt: null } } } } }
            : {};
    return {
      deletedAt: null,
      // Same people as the students directory, with a profile to summarise.
      AND: [LEARNER_USER, userSearch(f.q), population, { profile: { isNot: null } }],
      ...(hasProfileFilter(f) ? { profile: profileWhere(f) } : {}),
    };
  }

  async insights(f: TalentFilter): Promise<TalentInsightsDto> {
    const where = this.where(f);
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: TALENT_LIMIT + 1,
      select: {
        id: true,
        profile: {
          select: {
            fullNameEn: true,
            country: true,
            jobTitle: true,
            employmentStatus: true,
            experienceYears: true,
            mlExperienceYears: true,
            seniority: true,
            primaryArea: true,
            secondaryAreas: true,
            industry: true,
            educationLevel: true,
            cloudPlatforms: true,
            productionTools: true,
            learningGoals: true,
            interestedTopics: true,
            weeklyHours: true,
            skills: { select: { skill: true, level: true } },
          },
        },
        enrollments: { select: { certificate: { select: { revokedAt: true } } } },
      },
    });
    const truncated = users.length > TALENT_LIMIT;
    const kept = users.slice(0, TALENT_LIMIT);
    // What they did in our courses, for the same students (a relation filter, not a list of ids: no bind-parameter limit).
    const [attendance, graded, points] = await Promise.all([
      this.prisma.sessionAttendance.groupBy({ by: ['userId', 'status'], where: { user: where }, _count: { _all: true } }),
      this.prisma.submission.groupBy({
        by: ['userId'],
        where: { user: where, gradedAt: { not: null }, score: { not: null } },
        _sum: { score: true, maxScore: true },
      }),
      this.prisma.pointsEntry.groupBy({ by: ['userId'], where: { user: where, voidedAt: null }, _sum: { points: true } }),
    ]);
    const att = new Map<string, { attended: number; marked: number }>();
    for (const a of attendance) {
      const m = att.get(a.userId) ?? { attended: 0, marked: 0 };
      m.marked += a._count._all;
      m.attended += a.status === 'PRESENT' ? a._count._all : a.status === 'PARTIAL' ? a._count._all / 2 : 0;
      att.set(a.userId, m);
    }
    const grades = new Map(graded.map((g) => [g.userId, { score: g._sum.score ?? 0, max: g._sum.maxScore ?? 0 }]));
    const pts = new Map(points.map((p) => [p.userId, p._sum.points ?? 0]));

    const rows: TalentRow[] = kept.map((u) => {
      const p = u.profile!;
      return {
        id: u.id,
        name: p.fullNameEn,
        country: p.country,
        jobTitle: p.jobTitle,
        employmentStatus: p.employmentStatus,
        experienceYears: p.experienceYears,
        mlExperienceYears: p.mlExperienceYears,
        seniority: p.seniority,
        primaryArea: p.primaryArea,
        secondaryAreas: p.secondaryAreas,
        industry: p.industry,
        educationLevel: p.educationLevel,
        skills: Object.fromEntries(p.skills.map((s) => [s.skill, s.level])) as Partial<Record<Skill, number>>,
        cloudPlatforms: p.cloudPlatforms,
        productionTools: p.productionTools,
        learningGoals: p.learningGoals,
        interestedTopics: p.interestedTopics,
        weeklyHours: p.weeklyHours,
        enrollments: u.enrollments.length,
        certificates: u.enrollments.filter((e) => e.certificate && !e.certificate.revokedAt).length,
        attendedSessions: att.get(u.id)?.attended ?? 0,
        markedSessions: att.get(u.id)?.marked ?? 0,
        gradedScore: grades.get(u.id)?.score ?? 0,
        gradedMax: grades.get(u.id)?.max ?? 0,
        points: pts.get(u.id) ?? 0,
      };
    });
    return summarizeTalents(rows, truncated);
  }
}
