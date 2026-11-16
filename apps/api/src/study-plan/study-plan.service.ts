import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { localIsoDate, type StudyPlanDto, type StudyPlanInput } from '@academy/shared';
import type { StudyPlan } from '@prisma/client';
import type { AuthUser } from '../common/decorators';
import { PublicRevalidator } from '../common/revalidate';
import { PrismaService } from '../prisma/prisma.service';
import { loadStudyItems, planStartDate, planTimezone, scheduleOf } from './study-items';

/**
 * A student's study plan for a self-paced course: read, save, delete, with the schedule summary
 * the learn page shows. Only a real enrolment may use it (admin previews can't), and only on a
 * self-paced course.
 */
@Injectable()
export class StudyPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidator: PublicRevalidator,
  ) {}

  private async course(user: AuthUser, slug: string): Promise<{ id: string; selfPaced: boolean }> {
    const course = await this.prisma.course.findUnique({ where: { slug }, select: { id: true, selfPaced: true } });
    if (!course) throw new NotFoundException('Course not found');
    const enrollment = await this.prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } }, select: { id: true } });
    if (!enrollment) throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    if (!course.selfPaced) throw new ConflictException({ code: 'NOT_SELF_PACED', message: 'Study plans are for self-paced courses' });
    return course;
  }

  private async timezone(userId: string): Promise<{ timezone: string; timezoneIsDefault: boolean }> {
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { timezone: true } });
    const timezone = planTimezone(profile?.timezone);
    // Only the fallback counts as "default": a student who chose Africa/Cairo has set it.
    return { timezone, timezoneIsDefault: timezone !== profile?.timezone };
  }

  async get(user: AuthUser, slug: string, now = new Date()): Promise<StudyPlanDto> {
    const course = await this.course(user, slug);
    return this.dto(user.id, course.id, await this.prisma.studyPlan.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } }), now);
  }

  async save(user: AuthUser, slug: string, input: StudyPlanInput, now = new Date()): Promise<StudyPlanDto> {
    const course = await this.course(user, slug);
    const data = { weekdays: input.weekdays, minutesPerDay: input.minutesPerDay, startDate: new Date(`${input.startDate}T00:00:00Z`), reminderHour: input.reminderHour };
    const plan = await this.prisma.studyPlan.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      update: data,
      create: { ...data, userId: user.id, courseId: course.id },
    });
    await this.feedChanged(user.id);
    return this.dto(user.id, course.id, plan, now);
  }

  async remove(user: AuthUser, slug: string): Promise<void> {
    const course = await this.course(user, slug);
    const { count } = await this.prisma.studyPlan.deleteMany({ where: { userId: user.id, courseId: course.id } });
    if (count) await this.feedChanged(user.id);
  }

  /**
   * Study blocks are in the private calendar feed, which the edge keeps for FEED_TTL
   * (deploy/cloudflare/src/edge-cache.ts): purge it as a reset link does, but only for a
   * student who has a feed (most saves then cost nothing).
   */
  private async feedChanged(userId: string): Promise<void> {
    if (await this.prisma.calendarFeed.count({ where: { userId } })) this.revalidator.changed();
  }

  private async dto(userId: string, courseId: string, plan: StudyPlan | null, now: Date): Promise<StudyPlanDto> {
    const tz = await this.timezone(userId);
    if (!plan) return { ...tz, plan: null, summary: null };
    const { byUser, titles } = await loadStudyItems(this.prisma, courseId, [userId]);
    const items = byUser.get(userId) ?? [];
    const today = localIsoDate(now, tz.timezone);
    const { schedule, onTrack, behindBy } = scheduleOf(plan, items, today);
    const next = schedule.days[0];
    return {
      ...tz,
      plan: { weekdays: plan.weekdays, minutesPerDay: plan.minutesPerDay, startDate: planStartDate(plan), reminderHour: plan.reminderHour, updatedAt: plan.updatedAt.toISOString() },
      summary: {
        nextDay: next
          ? {
              date: next.date,
              minutes: next.minutes,
              items: next.items.map((i) => ({ ...i, titleEn: titles.get(i.id)?.titleEn ?? '', titleAr: titles.get(i.id)?.titleAr ?? '' })),
            }
          : null,
        targetDate: schedule.targetDate,
        onTrack,
        behindBy,
        totalItems: schedule.totalItems,
        remainingItems: schedule.remainingItems,
      },
    };
  }
}
