import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AUTOMATION_RULES,
  automationParams,
  automationRule,
  automationRuleSchema,
  type AutomationLogEntryDto,
  type AutomationOverviewDto,
  type AutomationPreviewDto,
  type AutomationRuleDef,
  type AutomationRuleType,
  type Locale,
} from '@academy/shared';
import type { CourseAutomationRule, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CertificatesService } from '../certificates/certificates.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailPreferenceLinks } from '../outbox/email-links';
import { Outbox, type OutboxMessage } from '../outbox/outbox.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseData, RULES, type CourseRow, type Hit, type RuleResult } from './engine';
import { alertTexts } from './texts';

const DAY = 86_400_000;
/** Automation emails per student per day; more still arrive in-app. */
export const DAILY_EMAIL_CAP = 3;
/** Emails wait for 08:00 Cairo time when a rule fires between 22:00 and 08:00. */
const QUIET_FROM = 22;
const QUIET_UNTIL = 8;
const AT_RISK_TYPES: AutomationRuleType[] = ['MISSED_IN_A_ROW', 'AT_RISK_EARLY'];

const COURSE_SELECT = {
  id: true,
  slug: true,
  titleEn: true,
  titleAr: true,
  status: true,
  type: true,
  capacity: true,
  startDate: true,
  endDate: true,
  recordingsPlatform: true,
  certMinSessionsPercent: true,
  certRequireAssessments: true,
  automationPaused: true,
} as const;

function cairoHour(at: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(at));
}

/** Null outside quiet hours; otherwise the next 08:00 in Cairo. */
export function quietUntil(now: Date): Date | null {
  const h = cairoHour(now);
  if (h >= QUIET_UNTIL && h < QUIET_FROM) return null;
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24; i++) {
    t.setTime(t.getTime() + 3_600_000);
    if (cairoHour(t) === QUIET_UNTIL) return t;
  }
  return null;
}

/**
 * Course automation rules (packages/shared/src/automation.ts): settings for the Automation tab
 * and the hourly run. A run evaluates each rule that is on (engine.ts), drops what it already
 * did (AutomationFiring is the log and the "done" marker, one row per rule and occasion), then
 * messages students (in-app, and email through the outbox with the per-course reminder or
 * feedback opt-out, quiet hours and a daily cap), alerts the course team once per rule and run,
 * and awards points or issues certificates. Nothing here changes an application's status.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: Outbox,
    private readonly links: EmailPreferenceLinks,
    private readonly notifications: NotificationsService,
    private readonly points: PointsService,
    private readonly certificates: CertificatesService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private def(type: string): AutomationRuleDef {
    const def = automationRule(type);
    if (!def) throw new NotFoundException({ code: 'UNKNOWN_RULE', message: 'Unknown automation rule' });
    return def;
  }

  private async course(courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: COURSE_SELECT });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  private data(course: CourseRow, now: Date): CourseData {
    return new CourseData(this.prisma, course, now, (userIds) => this.certificates.eligibilityFor(course, userIds));
  }

  /** Open or Closed, or Completed within 30 days of its end: the rules don't run on drafts or archives. */
  private active(c: { status: string; endDate: Date | null }, now: Date): boolean {
    if (c.status === 'OPEN' || c.status === 'CLOSED') return true;
    return c.status === 'COMPLETED' && (!c.endDate || c.endDate.getTime() > now.getTime() - 30 * DAY);
  }

  // ------------------------------------------------------------------ settings (the Automation tab)

  async overview(courseId: string, now = new Date()): Promise<AutomationOverviewDto> {
    const course = await this.course(courseId);
    const [rows, counts, week, flagged] = await Promise.all([
      this.prisma.courseAutomationRule.findMany({ where: { courseId }, include: { updatedBy: { select: { email: true } } } }),
      this.prisma.automationFiring.groupBy({ by: ['type'], where: { courseId }, _count: { _all: true } }),
      this.prisma.automationFiring.groupBy({ by: ['type'], where: { courseId, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, _count: { _all: true } }),
      this.prisma.automationFiring.findMany({
        where: { courseId, type: { in: AT_RISK_TYPES }, userId: { not: null }, createdAt: { gte: new Date(now.getTime() - 14 * DAY) } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { type: true, createdAt: true, user: { select: { id: true, email: true, deletedAt: true, profile: { select: { fullNameEn: true } } } } },
      }),
    ]);
    const byType = new Map(rows.map((r) => [r.type, r]));
    const total = new Map(counts.map((c) => [c.type, c._count._all]));
    const recent = new Map(week.map((c) => [c.type, c._count._all]));
    const seen = new Set<string>();
    return {
      paused: course.automationPaused,
      courseActive: this.active(course, now),
      rules: AUTOMATION_RULES.map((def) => {
        const r = byType.get(def.type);
        return {
          type: def.type,
          group: def.group,
          audience: def.audience,
          enabled: r?.enabled ?? false,
          params: automationParams(def, r?.params),
          noteEn: r?.noteEn ?? '',
          noteAr: r?.noteAr ?? '',
          recommended: def.recommended,
          fired: total.get(def.type) ?? 0,
          firedThisWeek: recent.get(def.type) ?? 0,
          updatedAt: r?.updatedAt.toISOString() ?? null,
          updatedBy: r?.updatedBy?.email ?? null,
        };
      }),
      // Latest flag per student; deleted accounts are left out.
      atRisk: flagged
        .filter((f) => f.user && !f.user.deletedAt && !seen.has(f.user.id) && seen.add(f.user.id))
        .map((f) => ({
          userId: f.user!.id,
          name: f.user!.profile?.fullNameEn ?? null,
          email: f.user!.email,
          reason: f.type as AutomationRuleType,
          at: f.createdAt.toISOString(),
        })),
    };
  }

  async save(courseId: string, type: string, body: unknown, actorId: string): Promise<AutomationOverviewDto> {
    const def = this.def(type);
    await this.course(courseId);
    const parsed = automationRuleSchema(def).safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const v = parsed.data;
    const data = { enabled: v.enabled, params: v.params as Prisma.InputJsonValue, noteEn: def.note ? v.noteEn : '', noteAr: def.note ? v.noteAr : '', updatedById: actorId };
    await this.prisma.courseAutomationRule.upsert({
      where: { courseId_type: { courseId, type } },
      update: data,
      create: { courseId, type, ...data },
    });
    await this.audit.log({ actorId, action: 'automation.rule_saved', entityType: 'Course', entityId: courseId, metadata: { type, enabled: v.enabled } });
    return this.overview(courseId);
  }

  /** "Turn on the recommended set": switches those rules on, keeping any settings already saved. */
  async enableRecommended(courseId: string, actorId: string): Promise<AutomationOverviewDto> {
    await this.course(courseId);
    const types = AUTOMATION_RULES.filter((r) => r.recommended).map((r) => r.type);
    await this.prisma.$transaction(
      types.map((type) =>
        this.prisma.courseAutomationRule.upsert({
          where: { courseId_type: { courseId, type } },
          update: { enabled: true, updatedById: actorId },
          create: { courseId, type, enabled: true, updatedById: actorId },
        }),
      ),
    );
    await this.audit.log({ actorId, action: 'automation.recommended_enabled', entityType: 'Course', entityId: courseId, metadata: { types } });
    return this.overview(courseId);
  }

  async setPaused(courseId: string, paused: boolean, actorId: string): Promise<AutomationOverviewDto> {
    await this.course(courseId);
    await this.prisma.course.update({ where: { id: courseId }, data: { automationPaused: paused } });
    await this.audit.log({ actorId, action: paused ? 'automation.paused' : 'automation.resumed', entityType: 'Course', entityId: courseId });
    return this.overview(courseId);
  }

  /** Who the rule would act for if it ran now, with the settings sent (or saved), already-done cases excluded. */
  async preview(courseId: string, type: string, body: unknown, now = new Date()): Promise<AutomationPreviewDto> {
    const def = this.def(type);
    const course = await this.course(courseId);
    const saved = await this.prisma.courseAutomationRule.findUnique({ where: { courseId_type: { courseId, type } } });
    const parsed = automationRuleSchema(def).safeParse(body);
    const params = automationParams(def, parsed.success ? parsed.data.params : saved?.params);
    const result = await RULES[type as AutomationRuleType](this.data(course, now), params);
    const fresh = saved ? await this.unseen(saved.id, result.hits) : result.hits;
    return { count: fresh.length, sample: fresh.slice(0, 20).map((h) => h.label) };
  }

  async log(courseId: string, take = 100): Promise<AutomationLogEntryDto[]> {
    await this.course(courseId);
    const rows = await this.prisma.automationFiring.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, type: true, subject: true, actions: true, createdAt: true, user: { select: { email: true, profile: { select: { fullNameEn: true } } } } },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type as AutomationRuleType,
      subject: r.user ? r.user.profile?.fullNameEn || r.user.email : r.subject,
      actions: r.actions,
      at: r.createdAt.toISOString(),
    }));
  }

  // ------------------------------------------------------------------ the hourly run

  /** Runs every rule that is on, in every active course that isn't paused. Returns how many times rules acted. */
  async runAll(now = new Date()): Promise<number> {
    const rules = await this.prisma.courseAutomationRule.findMany({
      where: { enabled: true, course: { automationPaused: false, status: { in: ['OPEN', 'CLOSED', 'COMPLETED'] } } },
      include: { course: { select: COURSE_SELECT } },
      orderBy: { courseId: 'asc' },
    });
    let acted = 0;
    let data: CourseData | null = null;
    for (const rule of rules) {
      if (!this.active(rule.course, now) || !automationRule(rule.type)) continue;
      // One CourseData per course: the course's rules share what they load.
      if (data?.course.id !== rule.courseId) data = this.data(rule.course, now);
      try {
        acted += await this.runRule(rule, data);
      } catch (err) {
        // One rule failing must not stop the others; its next run retries.
        this.logger.error(`Automation rule ${rule.type} failed: ${(err as Error).name}`);
      }
    }
    if (acted) this.outbox.kick();
    return acted;
  }

  private async unseen(ruleId: string, hits: Hit[]): Promise<Hit[]> {
    if (!hits.length) return hits;
    const done = new Set(
      (await this.prisma.automationFiring.findMany({ where: { ruleId, dedupeKey: { in: hits.map((h) => h.key) } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey),
    );
    return hits.filter((h) => !done.has(h.key));
  }

  async runRule(rule: CourseAutomationRule, data: CourseData): Promise<number> {
    const def = this.def(rule.type);
    const params = automationParams(def, rule.params);
    const result = await RULES[rule.type as AutomationRuleType](data, params);
    const hits = await this.unseen(rule.id, result.hits);
    if (!hits.length) return 0;
    const course = data.course;
    const now = data.now;

    // The students messaged, with their language and this course's email switches.
    const ids = [...new Set(hits.filter((h) => h.message && h.userId).map((h) => h.userId!))];
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids }, deletedAt: null, anonymizedAt: null },
          select: { id: true, locale: true, reminderPreferences: { where: { courseId: course.id }, select: { emailReminders: true, feedbackEmails: true } } },
        })
      ).map((u) => [u.id, u]),
    );
    const sentToday = new Map(
      (
        await this.prisma.outboundEmail.groupBy({
          by: ['userId'],
          where: { userId: { in: ids }, category: 'automation', createdAt: { gte: new Date(now.getTime() - DAY) }, status: { not: 'SKIPPED' } },
          _count: { _all: true },
        })
      ).map((g) => [g.userId!, g._count._all]),
    );
    const notBefore = quietUntil(now);
    const names = data.names;
    const note = (l: Locale) => (def.note ? (l === 'ar' ? rule.noteAr || rule.noteEn : rule.noteEn || rule.noteAr) || null : null);

    const outbox: OutboxMessage[] = [];
    const notices: Prisma.NotificationCreateManyInput[] = [];
    const firings: Prisma.AutomationFiringCreateManyInput[] = [];
    const keyOfEmail = (h: Hit) => `automation:${rule.id}:${h.key}`;
    for (const h of hits) {
      const actions: string[] = [];
      const u = h.userId ? users.get(h.userId) : undefined;
      if (h.message && u) {
        const locale: Locale = u.locale === 'ar' ? 'ar' : 'en';
        const w = h.message.text[locale];
        const pref = u.reminderPreferences[0];
        const optedOut = h.message.optOut === 'feedback' ? pref?.feedbackEmails === false : pref?.emailReminders === false;
        const count = sentToday.get(u.id) ?? 0;
        const capped = count >= DAILY_EMAIL_CAP;
        if (!optedOut && !capped) sentToday.set(u.id, count + 1);
        outbox.push({
          userId: u.id,
          locale,
          category: h.message.optOut === 'feedback' ? 'feedback' : 'automation',
          courseId: course.id,
          dedupeKey: keyOfEmail(h),
          ...(notBefore ? { notBefore } : {}),
          ...(optedOut ? { skip: 'opted_out' } : capped ? { skip: 'daily_cap' } : {}),
          template: {
            name: 'automationMessage',
            courseTitle: locale === 'ar' ? names.ar : names.en,
            heading: w.title,
            paragraphs: w.lines,
            note: note(locale),
            cta: { label: w.cta, url: h.message.url ?? `${this.env.WEB_URL}/${locale}${h.message.path}` },
            unsubscribeUrl: this.links.pageUrl(locale, h.message.optOut, u.id, course.id),
            optOut: h.message.optOut,
          },
        });
        notices.push({
          userId: u.id,
          type: `automation.${rule.type.toLowerCase()}`,
          titleEn: h.message.text.en.title,
          titleAr: h.message.text.ar.title,
          bodyEn: h.message.text.en.lines[0] ?? '',
          bodyAr: h.message.text.ar.lines[0] ?? '',
          link: h.message.path,
        });
        actions.push('message');
        if (!optedOut && !capped) actions.push('email');
      }
      if (h.alert) actions.push('alert');
      if (h.points) actions.push('points');
      if (h.certificate) actions.push('certificate');
      if (h.flag) actions.push('flag');
      firings.push({ ruleId: rule.id, courseId: course.id, type: rule.type, dedupeKey: h.key, userId: h.userId, subject: h.subject ?? '', actions });
    }

    // The firing, the notification and the email row commit together: a firing that exists means "done".
    const created = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.automationFiring.createManyAndReturn({ data: firings, skipDuplicates: true, select: { dedupeKey: true } });
      const keys = new Set(rows.map((r) => r.dedupeKey));
      const mine = (userId: string, key: string) => keys.has(key) && hits.some((h) => h.key === key && h.userId === userId);
      const emails = outbox.filter((m) => mine(m.userId, m.dedupeKey.slice(`automation:${rule.id}:`.length)));
      if (emails.length) await this.outbox.enqueue(emails, tx);
      const sent = new Set(emails.map((m) => m.userId));
      const ns = notices.filter((n) => sent.has(n.userId));
      if (ns.length) await tx.notification.createMany({ data: ns });
      return hits.filter((h) => keys.has(h.key));
    });
    if (!created.length) return 0;

    // Points and certificates: idempotent services, after the commit.
    let failedCertificates = 0;
    for (const h of created) {
      if (h.points && h.userId) await this.points.syncAutomation(h.userId, course.id, h.points.source, h.points.amount, now).catch(() => undefined);
      if (h.certificate) {
        try {
          await this.certificates.issue(h.certificate.enrollmentId, { issuedById: rule.updatedById });
        } catch {
          failedCertificates++;
        }
      }
    }

    const alerts = created.filter((h) => h.alert).length;
    if (alerts && result.alert) await this.alertTeam(def, course, result, alerts - failedCertificates);
    if (failedCertificates) await this.alertTeam(def, course, { ...result, alert: (c) => alertTexts.certFailed(names, c) }, failedCertificates);
    return created.length;
  }

  /**
   * One in-app alert to the course team members holding the rule's permission; when the course
   * has none (or the alert is admin-only, like payment proofs), to admins with the rule's presets.
   */
  private async alertTeam(def: AutomationRuleDef, course: CourseRow, result: RuleResult, count: number): Promise<void> {
    if (count <= 0 || !result.alert || !result.link) return;
    const text = result.alert(count);
    const type = `automation.alert.${def.type.toLowerCase()}`;
    const adminLink = result.link.admin.startsWith('/') ? result.link.admin : `/admin/courses/${course.id}?tab=${result.link.admin}`;
    try {
      if (def.staffPermission && result.link.teach) {
        const staff = await this.prisma.courseStaff.findMany({
          where: { courseId: course.id, userId: { not: null }, user: { deletedAt: null }, role: { permissions: { has: def.staffPermission } } },
          select: { userId: true },
        });
        const userIds = [...new Set(staff.map((s) => s.userId!))];
        if (userIds.length) {
          const link = `/teach/courses/${course.id}?tab=${result.link.teach}`;
          for (const userId of userIds) await this.notifications.create(userId, { type, ...text, link });
          return;
        }
      }
      if (def.adminPresets?.length) await this.notifications.notifyAdmins({ type, ...text, link: adminLink }, [...def.adminPresets]);
    } catch {
      this.logger.error(`Automation alert for ${def.type} failed`);
    }
  }
}
