import {
  attemptsLeft,
  countedAttempt,
  SEAT_HOLDING_STATUSES,
  type AutomationParams,
  type AutomationRuleType,
  type Eligibility,
} from '@academy/shared';
import { formatDueAt } from '../assessments/due-format';
import { formatStart } from '../applications/workflow.service';
import { LEARNER_ROLE_FILTER } from '../common/learners';
import type { PrismaService } from '../prisma/prisma.service';
import { alertTexts, studentTexts, type AlertText, type CourseNames, type StudentText } from './texts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ATTENDED = new Set(['PRESENT', 'PARTIAL']);

/** A message to one student: in-app always, email unless they turned this kind off. */
export interface StudentMessage {
  text: StudentText;
  /** Path without a locale, e.g. /learn/<slug>#sessions. External links go in the text. */
  path: string;
  /** An external button target (e.g. a Telegram invite); otherwise the path. */
  url?: string;
  /** Which per-course opt-out applies to the email. */
  optOut: 'reminders' | 'feedback';
}

/** One thing a rule found to act on. The key makes it happen once per rule. */
export interface Hit {
  key: string;
  /** The student it is about (messages, points, flags); null for alerts about a session or the course. */
  userId: string | null;
  /** For the log and the preview: a name, or what a team alert is about. */
  label: string;
  subject?: string;
  message?: StudentMessage;
  /** Counted into one team alert per rule and run. */
  alert?: true;
  points?: { amount: number; source: string };
  certificate?: { enrollmentId: string };
  flag?: true;
}

export interface RuleResult {
  hits: Hit[];
  /** Builds the run's single team alert from how many hits carry `alert`. */
  alert?: (count: number) => AlertText;
  /** Where the alert points: an admin course tab and a /teach tab (or an admin-only page). */
  link?: { admin: string; teach: string | null };
}

interface Student {
  userId: string;
  enrollmentId: string;
  enrolledAt: Date;
  locale: 'en' | 'ar';
  label: string;
  timezone: string | null;
  telegram: string | null;
  googleEmail: string | null;
}

export interface CourseRow {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  status: string;
  type: string;
  capacity: number | null;
  startDate: Date | null;
  endDate: Date | null;
  recordingsPlatform: string;
  certMinSessionsPercent: number | null;
  certRequireAssessments: boolean;
}

interface Session {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
  start: number;
  end: number;
  liveUrl: string | null;
  recordingUrl: string | null;
  hasMaterials: boolean;
}

/**
 * Everything a course's rules read, loaded on first use and shared by every rule of one run.
 */
export class CourseData {
  readonly names: CourseNames;
  private cache = new Map<string, Promise<unknown>>();

  constructor(
    readonly prisma: PrismaService,
    readonly course: CourseRow,
    readonly now: Date,
    private readonly eligibilityFor: (userIds: string[]) => Promise<Map<string, Eligibility>>,
  ) {
    this.names = { en: course.titleEn, ar: course.titleAr || course.titleEn };
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key) as Promise<T>;
  }

  get t(): number {
    return this.now.getTime();
  }

  sessions(): Promise<Session[]> {
    return this.once('sessions', async () =>
      (
        await this.prisma.courseSession.findMany({
          where: { courseId: this.course.id },
          select: { id: true, order: true, titleEn: true, titleAr: true, startsAt: true, durationMin: true, liveUrl: true, recordingUrl: true, materials: true },
          orderBy: { startsAt: 'asc' },
        })
      ).map((s) => ({
        id: s.id,
        order: s.order,
        titleEn: s.titleEn,
        titleAr: s.titleAr || s.titleEn,
        start: s.startsAt.getTime(),
        end: s.startsAt.getTime() + s.durationMin * MIN,
        liveUrl: s.liveUrl?.trim() || null,
        recordingUrl: s.recordingUrl?.trim() || null,
        hasMaterials: Array.isArray(s.materials) && s.materials.length > 0,
      })),
    );
  }

  /** The course's end: its end date, else the end of its last session. */
  async end(): Promise<number | null> {
    if (this.course.endDate) return this.course.endDate.getTime();
    const s = await this.sessions();
    return s.length ? s[s.length - 1]!.end : null;
  }

  async start(): Promise<number | null> {
    const s = await this.sessions();
    return s[0]?.start ?? this.course.startDate?.getTime() ?? null;
  }

  /** Enrolled learners with live accounts. */
  students(): Promise<Student[]> {
    return this.once('students', async () =>
      (
        await this.prisma.enrollment.findMany({
          where: { courseId: this.course.id, user: { role: LEARNER_ROLE_FILTER, deletedAt: null, anonymizedAt: null } },
          select: {
            id: true,
            enrolledAt: true,
            user: {
              select: {
                id: true,
                email: true,
                locale: true,
                profile: { select: { fullNameEn: true, timezone: true, telegramUsername: true, googleEmail: true } },
              },
            },
          },
        })
      ).map((e) => ({
        userId: e.user.id,
        enrollmentId: e.id,
        enrolledAt: e.enrolledAt,
        locale: e.user.locale === 'ar' ? 'ar' : 'en',
        label: e.user.profile?.fullNameEn || e.user.email,
        timezone: e.user.profile?.timezone ?? null,
        telegram: e.user.profile?.telegramUsername ?? null,
        googleEmail: e.user.profile?.googleEmail ?? null,
      })),
    );
  }

  /** Attendance per session that has any recorded: sessionId → userId → status. */
  attendance(): Promise<Map<string, Map<string, string>>> {
    return this.once('attendance', async () => {
      const rows = await this.prisma.sessionAttendance.findMany({
        where: { session: { courseId: this.course.id } },
        select: { sessionId: true, userId: true, status: true },
      });
      const out = new Map<string, Map<string, string>>();
      for (const r of rows) {
        if (!out.has(r.sessionId)) out.set(r.sessionId, new Map());
        out.get(r.sessionId)!.set(r.userId, r.status);
      }
      return out;
    });
  }

  /** Past sessions whose attendance was recorded, oldest first. */
  async recordedSessions(): Promise<Session[]> {
    const [sessions, att] = await Promise.all([this.sessions(), this.attendance()]);
    return sessions.filter((s) => s.end <= this.t && att.has(s.id));
  }

  assessments() {
    return this.once('assessments', () =>
      this.prisma.assessment.findMany({
        where: { courseId: this.course.id, status: 'PUBLISHED' },
        select: {
          id: true,
          type: true,
          titleEn: true,
          titleAr: true,
          dueAt: true,
          allowLate: true,
          passPercent: true,
          attemptsAllowed: true,
          scoring: true,
          session: { select: { order: true } },
          submissions: {
            select: { id: true, userId: true, attempt: true, submittedAt: true, score: true, maxScore: true, gradedAt: true },
          },
        },
      }),
    );
  }

  eligibility(): Promise<Map<string, Eligibility>> {
    return this.once('eligibility', async () => this.eligibilityFor((await this.students()).map((s) => s.userId)));
  }

  seatsTaken(): Promise<number> {
    return this.once('seats', () =>
      this.prisma.application.count({ where: { courseId: this.course.id, status: { in: [...SEAT_HOLDING_STATUSES] }, user: { deletedAt: null } } }),
    );
  }

  /** Live applicants' applications in these statuses, with when they entered that status. */
  async applications(statuses: string[]): Promise<{ id: string; userId: string; status: string; since: number; label: string }[]> {
    const apps = await this.prisma.application.findMany({
      where: { courseId: this.course.id, status: { in: statuses as never[] }, user: { deletedAt: null, anonymizedAt: null } },
      select: {
        id: true,
        userId: true,
        status: true,
        createdAt: true,
        user: { select: { email: true, profile: { select: { fullNameEn: true } } } },
        history: { orderBy: { createdAt: 'desc' }, take: 1, select: { toStatus: true, createdAt: true } },
      },
    });
    return apps.map((a) => {
      const h = a.history[0];
      return {
        id: a.id,
        userId: a.userId,
        status: a.status,
        since: (h && h.toStatus === a.status ? h.createdAt : a.createdAt).getTime(),
        label: a.user.profile?.fullNameEn || a.user.email,
      };
    });
  }

  learn(anchor = ''): string {
    return `/learn/${this.course.slug}${anchor}`;
  }
}

const msg = (text: StudentText, path: string, optOut: 'reminders' | 'feedback' = 'reminders', url?: string): StudentMessage => ({ text, path, optOut, ...(url ? { url } : {}) });
const n = (p: AutomationParams, k: string) => Number(p[k]);
const pct = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 100) : 0);
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Monday-based week number since 1970, for "once a week" keys. */
export const weekIndex = (t: number) => Math.floor((t + 3 * DAY) / (7 * DAY));

type Rule = (d: CourseData, p: AutomationParams) => Promise<RuleResult>;

/** Sessions (oldest first) a student could attend: those that started after they enrolled, or ended after. */
const theirs = (sessions: Session[], s: Student) => sessions.filter((x) => x.end > s.enrolledAt.getTime());

export const RULES: Record<AutomationRuleType, Rule> = {
  // ------------------------------------------------------------------ attendance and engagement
  async MISSED_IN_A_ROW(d, p) {
    const need = n(p, 'sessions');
    const [recorded, att, students] = await Promise.all([d.recordedSessions(), d.attendance(), d.students()]);
    const hits: Hit[] = [];
    for (const s of students) {
      const mine = theirs(recorded, s).slice(-need);
      if (mine.length < need || mine.some((x) => ATTENDED.has(att.get(x.id)?.get(s.userId) ?? ''))) continue;
      const last = mine[mine.length - 1]!;
      hits.push({
        key: `${s.userId}:${last.id}`,
        userId: s.userId,
        label: s.label,
        message: msg(studentTexts.missedInARow(d.names, need), d.learn('#sessions')),
        alert: true,
        flag: true,
      });
    }
    return { hits, alert: (c) => alertTexts.missedInARow(d.names, c, need), link: { admin: 'automation', teach: 'automation' } };
  },

  async AT_RISK_EARLY(d, p) {
    const first = n(p, 'sessions');
    const [sessions, att, students] = await Promise.all([d.sessions(), d.attendance(), d.students()]);
    const opening = sessions.slice(0, first);
    if (opening.length < first || opening.some((x) => x.end > d.t || !att.has(x.id))) return { hits: [] };
    const hits = students
      .filter((s) => s.enrolledAt.getTime() < opening[0]!.end && !opening.some((x) => ATTENDED.has(att.get(x.id)?.get(s.userId) ?? '')))
      .map((s): Hit => ({ key: s.userId, userId: s.userId, label: s.label, alert: true, flag: true }));
    return { hits, alert: (c) => alertTexts.atRisk(d.names, c, first), link: { admin: 'automation', teach: 'automation' } };
  },

  async INACTIVE(d, p) {
    const days = n(p, 'days');
    const [sessions, start, end, students, att, assessments] = await Promise.all([d.sessions(), d.start(), d.end(), d.students(), d.attendance(), d.assessments()]);
    // Only while the course is running.
    if (start === null || start > d.t || (end !== null && end < d.t)) return { hits: [] };
    const ids = students.map((s) => s.userId);
    const [feedback, logins] = await Promise.all([
      d.prisma.sessionFeedback.groupBy({ by: ['userId'], where: { courseId: d.course.id, userId: { in: ids } }, _max: { updatedAt: true } }),
      d.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, lastLoginAt: true } }),
    ]);
    const lastSeen = new Map<string, number>();
    const seen = (u: string, t: number) => lastSeen.set(u, Math.max(lastSeen.get(u) ?? 0, t));
    for (const s of students) seen(s.userId, s.enrolledAt.getTime());
    for (const x of sessions) for (const [u, st] of att.get(x.id) ?? []) if (ATTENDED.has(st)) seen(u, x.start);
    for (const a of assessments) for (const sub of a.submissions) if (sub.submittedAt) seen(sub.userId, sub.submittedAt.getTime());
    for (const f of feedback) if (f._max.updatedAt) seen(f.userId, f._max.updatedAt.getTime());
    for (const u of logins) if (u.lastLoginAt) seen(u.id, u.lastLoginAt.getTime());
    const next = sessions.find((x) => x.start > d.t);
    const period = Math.floor(d.t / (days * DAY));
    const hits: Hit[] = [];
    for (const s of students) {
      if (d.t - (lastSeen.get(s.userId) ?? 0) < days * DAY) continue;
      const due = assessments.filter((a) => a.dueAt && a.dueAt.getTime() > d.t && !a.submissions.some((x) => x.userId === s.userId && x.submittedAt)).length;
      const when = next ? { en: formatStart(new Date(next.start), 'en', s.timezone), ar: formatStart(new Date(next.start), 'ar', s.timezone) } : { en: null, ar: null };
      hits.push({ key: `${s.userId}:${period}`, userId: s.userId, label: s.label, message: msg(studentTexts.inactive(d.names, when, due), d.learn()) });
    }
    return { hits };
  },

  async FULL_ATTENDANCE_MIDWAY(d, p) {
    const points = n(p, 'points');
    const [sessions, att, students] = await Promise.all([d.sessions(), d.attendance(), d.students()]);
    const half = Math.ceil(sessions.length / 2);
    const firstHalf = sessions.slice(0, half);
    if (sessions.length < 2 || firstHalf.some((x) => x.end > d.t || !att.has(x.id))) return { hits: [] };
    const hits = students
      .filter((s) => s.enrolledAt.getTime() < firstHalf[0]!.end && firstHalf.every((x) => ATTENDED.has(att.get(x.id)?.get(s.userId) ?? '')))
      .map(
        (s): Hit => ({
          key: s.userId,
          userId: s.userId,
          label: s.label,
          points: { amount: points, source: `FULL_ATTENDANCE_MIDWAY:${s.userId}` },
          message: msg(studentTexts.fullAttendance(d.names, points), d.learn('#leaderboard')),
        }),
      );
    return { hits };
  },

  async OFTEN_LATE(d, p) {
    const times = n(p, 'times');
    const [att, students] = await Promise.all([d.attendance(), d.students()]);
    const partial = new Map<string, number>();
    for (const m of att.values()) for (const [u, st] of m) if (st === 'PARTIAL') partial.set(u, (partial.get(u) ?? 0) + 1);
    const hits = students
      .filter((s) => (partial.get(s.userId) ?? 0) >= times)
      .map((s): Hit => ({ key: s.userId, userId: s.userId, label: s.label, message: msg(studentTexts.oftenLate(d.names), d.learn('#sessions')) }));
    return { hits };
  },

  // ------------------------------------------------------------------ assessments
  async DUE_SOON(d, p) {
    const hours = n(p, 'hours');
    const [assessments, students] = await Promise.all([d.assessments(), d.students()]);
    const hits: Hit[] = [];
    for (const a of assessments) {
      if (!a.dueAt || a.dueAt.getTime() <= d.t || a.dueAt.getTime() > d.t + hours * HOUR) continue;
      const started = new Set(a.submissions.map((x) => x.userId));
      for (const s of students) {
        if (started.has(s.userId)) continue;
        const due = { en: formatDueAt(a.dueAt, 'en', s.timezone), ar: formatDueAt(a.dueAt, 'ar', s.timezone) };
        hits.push({
          key: `${a.id}:${s.userId}`,
          userId: s.userId,
          label: s.label,
          message: msg(studentTexts.dueSoon(d.names, { en: a.titleEn, ar: a.titleAr || a.titleEn }, due), d.learn(`#assessment-${a.id}`)),
        });
      }
    }
    return { hits };
  },

  async DEADLINE_MISSED(d) {
    const [assessments, students] = await Promise.all([d.assessments(), d.students()]);
    const hits: Hit[] = [];
    for (const a of assessments) {
      // An hour of grace, and only recent deadlines (not every old one when the rule is switched on).
      if (!a.dueAt || a.dueAt.getTime() > d.t - HOUR || a.dueAt.getTime() < d.t - 7 * DAY) continue;
      const submitted = new Set(a.submissions.filter((x) => x.submittedAt).map((x) => x.userId));
      for (const s of students) {
        if (submitted.has(s.userId) || s.enrolledAt > a.dueAt) continue;
        hits.push({
          key: `${a.id}:${s.userId}`,
          userId: s.userId,
          label: s.label,
          subject: a.id,
          message: msg(studentTexts.deadlineMissed(d.names, { en: a.titleEn, ar: a.titleAr || a.titleEn }, a.allowLate), d.learn(`#assessment-${a.id}`)),
          alert: true,
        });
      }
    }
    return { hits, alert: (c) => alertTexts.deadlineMissed(d.names, c), link: { admin: 'assessments', teach: 'gradebook' } };
  },

  async QUIZ_FAILED(d) {
    const [assessments, students] = await Promise.all([d.assessments(), d.students()]);
    const byId = new Map(students.map((s) => [s.userId, s]));
    const hits: Hit[] = [];
    for (const a of assessments) {
      if (a.type !== 'QUIZ') continue;
      const byUser = new Map<string, typeof a.submissions>();
      for (const sub of a.submissions) byUser.set(sub.userId, [...(byUser.get(sub.userId) ?? []), sub]);
      for (const [userId, subs] of byUser) {
        const s = byId.get(userId);
        const counted = countedAttempt(subs, a.scoring);
        // Only a recent result, and only while the counted attempt is below the pass mark.
        if (!s || !counted?.submittedAt || counted.submittedAt.getTime() < d.t - 7 * DAY) continue;
        if (pct(counted.score!, counted.maxScore) >= a.passPercent) continue;
        hits.push({
          key: `${a.id}:${userId}:${counted.attempt}`,
          userId,
          label: s.label,
          message: msg(
            studentTexts.quizFailed(d.names, { en: a.titleEn, ar: a.titleAr || a.titleEn }, a.passPercent, attemptsLeft(a.attemptsAllowed, subs.length)),
            d.learn(a.session ? `#session-${a.session.order}` : `#assessment-${a.id}`),
          ),
        });
      }
    }
    return { hits };
  },

  async HIGH_SCORE(d, p) {
    const [need, points] = [n(p, 'percent'), n(p, 'points')];
    const [assessments, students] = await Promise.all([d.assessments(), d.students()]);
    const byId = new Map(students.map((s) => [s.userId, s]));
    const hits: Hit[] = [];
    for (const a of assessments) {
      const byUser = new Map<string, typeof a.submissions>();
      for (const sub of a.submissions) byUser.set(sub.userId, [...(byUser.get(sub.userId) ?? []), sub]);
      for (const [userId, subs] of byUser) {
        const s = byId.get(userId);
        const counted = countedAttempt(subs, a.scoring);
        if (!s || !counted) continue;
        const score = pct(counted.score!, counted.maxScore);
        if (score < need) continue;
        hits.push({
          key: `${a.id}:${userId}`,
          userId,
          label: s.label,
          points: { amount: points, source: `HIGH_SCORE:${a.id}:${userId}` },
          message: msg(studentTexts.highScore(d.names, { en: a.titleEn, ar: a.titleAr || a.titleEn }, score, points), '/dashboard/points'),
        });
      }
    }
    return { hits };
  },

  async MANDATORY_PASSED(d) {
    const [students, elig] = await Promise.all([d.students(), d.eligibility()]);
    const hits: Hit[] = [];
    for (const s of students) {
      const e = elig.get(s.userId);
      if (!e || e.assessments.required === 0 || !e.assessments.ok) continue;
      hits.push({
        key: s.userId,
        userId: s.userId,
        label: s.label,
        message: msg(studentTexts.mandatoryPassed(d.names, { ok: e.sessions.ok, required: e.sessions.required, percent: e.sessions.percent }), d.learn()),
      });
    }
    return { hits };
  },

  async UNGRADED(d, p) {
    const days = n(p, 'days');
    const assessments = await d.assessments();
    const hits: Hit[] = [];
    for (const a of assessments) {
      if (a.type === 'QUIZ') continue; // quizzes grade themselves
      for (const sub of a.submissions) {
        if (!sub.submittedAt || sub.gradedAt || sub.submittedAt.getTime() > d.t - days * DAY) continue;
        hits.push({ key: sub.id, userId: null, label: a.titleEn, subject: a.titleEn, alert: true });
      }
    }
    return { hits, alert: (c) => alertTexts.ungraded(d.names, c, days), link: { admin: 'assessments', teach: 'gradebook' } };
  },

  // ------------------------------------------------------------------ certificates
  async CERT_ELIGIBLE(d, p) {
    const end = await d.end();
    if (end === null || end > d.t) return { hits: [] };
    const [students, elig, certs] = await Promise.all([
      d.students(),
      d.eligibility(),
      d.prisma.certificate.findMany({ where: { enrollment: { courseId: d.course.id } }, select: { enrollmentId: true } }),
    ]);
    const issued = new Set(certs.map((c) => c.enrollmentId));
    const issue = p.mode === 'issue';
    const hits = students
      .filter((s) => elig.get(s.userId)?.eligible && !issued.has(s.enrollmentId))
      .map((s): Hit => ({ key: s.userId, userId: s.userId, label: s.label, alert: true, ...(issue ? { certificate: { enrollmentId: s.enrollmentId } } : {}) }));
    return { hits, alert: (c) => alertTexts.certEligible(d.names, c, issue), link: { admin: 'certificates', teach: 'certificates' } };
  },

  async CERT_ALMOST(d, p) {
    const days = n(p, 'days');
    const end = await d.end();
    if (end === null || end < d.t || end > d.t + days * DAY) return { hits: [] };
    const [students, elig] = await Promise.all([d.students(), d.eligibility()]);
    const hits: Hit[] = [];
    for (const s of students) {
      const e = elig.get(s.userId);
      // Exactly one rule short: attendance, or the required assessments.
      if (!e || e.eligible || e.sessions.ok === e.assessments.ok) continue;
      const missing = !e.sessions.ok ? { sessions: { required: e.sessions.required ?? 0, percent: e.sessions.percent } } : { assessments: e.assessments.required - e.assessments.passed };
      hits.push({ key: s.userId, userId: s.userId, label: s.label, message: msg(studentTexts.certAlmost(d.names, missing), d.learn()) });
    }
    return { hits };
  },

  // ------------------------------------------------------------------ feedback
  async LOW_RATING(d, p) {
    const max = n(p, 'rating');
    const rows = await d.prisma.sessionFeedback.findMany({
      where: { courseId: d.course.id, rating: { lte: max }, updatedAt: { gte: new Date(d.t - 7 * DAY) } },
      select: { id: true, rating: true },
    });
    // The key holds the rating: a student who lowers it again is counted again.
    const hits = rows.map((f): Hit => ({ key: `${f.id}:${f.rating}`, userId: null, label: `${f.rating}★`, subject: f.id, alert: true }));
    return { hits, alert: (c) => alertTexts.lowRating(d.names, c, max), link: { admin: 'feedback', teach: 'feedback' } };
  },

  async AVERAGE_DROP(d, p) {
    const [threshold, min] = [n(p, 'average'), n(p, 'minRatings')];
    const agg = await d.prisma.sessionFeedback.aggregate({ where: { courseId: d.course.id, sessionId: { not: null } }, _avg: { rating: true }, _count: { _all: true } });
    const avg = agg._avg.rating;
    if (agg._count._all < min || avg === null || avg >= threshold) return { hits: [] };
    return {
      hits: [{ key: `w${weekIndex(d.t)}`, userId: null, label: avg.toFixed(1), subject: 'average', alert: true }],
      alert: () => alertTexts.averageDrop(d.names, avg, threshold),
      link: { admin: 'feedback', teach: 'feedback' },
    };
  },

  async FEEDBACK_NUDGE(d, p) {
    const hours = n(p, 'hours');
    // Sessions that ended between `hours` and a day later ago: the first prompt went 30 minutes after.
    const due = (await d.sessions()).filter((s) => s.end <= d.t - hours * HOUR && s.end > d.t - hours * HOUR - DAY);
    if (!due.length) return { hits: [] };
    const [students, rated] = await Promise.all([
      d.students(),
      d.prisma.sessionFeedback.findMany({ where: { sessionId: { in: due.map((s) => s.id) } }, select: { sessionId: true, userId: true } }),
    ]);
    const done = new Set(rated.map((r) => `${r.sessionId}:${r.userId}`));
    const hits: Hit[] = [];
    for (const s of due) {
      for (const st of students) {
        if (st.enrolledAt.getTime() > s.end || done.has(`${s.id}:${st.userId}`)) continue;
        hits.push({
          key: `${s.id}:${st.userId}`,
          userId: st.userId,
          label: st.label,
          message: msg(studentTexts.feedbackNudge(d.names, { en: s.titleEn, ar: s.titleAr, order: s.order }), d.learn(`#session-${s.order}-feedback`), 'feedback'),
        });
      }
    }
    return { hits };
  },

  // ------------------------------------------------------------------ admissions, seats and payments
  async PAYMENT_REMINDER(d, p) {
    const [first, second] = [n(p, 'firstDays'), n(p, 'secondDays')];
    // Reminders only: the seat is kept whatever happens (no rule ever releases one).
    const hits: Hit[] = [];
    for (const a of await d.applications(['AWAITING_PAYMENT', 'PAYMENT_REJECTED'])) {
      const waited = d.t - a.since;
      if (waited < first * DAY) continue;
      const late = waited >= second * DAY;
      hits.push({
        key: `${a.id}:${late ? 2 : 1}`,
        userId: a.userId,
        label: a.label,
        subject: a.id,
        message: msg(studentTexts.paymentReminder(d.names, late), `/dashboard/applications/${a.id}#payment-title`),
        ...(late ? { alert: true as const } : {}),
      });
    }
    return { hits, alert: (c) => alertTexts.paymentDue(d.names, c, second), link: { admin: 'applications', teach: 'applications' } };
  },

  async SEAT_OPEN_WAITLIST(d) {
    if (!d.course.capacity || d.course.status !== 'OPEN') return { hits: [] };
    const free = d.course.capacity - (await d.seatsTaken());
    if (free <= 0) return { hits: [] };
    const [waitlisted, interested] = await Promise.all([
      d.prisma.application.count({ where: { courseId: d.course.id, status: 'WAITLISTED', user: { deletedAt: null } } }),
      d.prisma.courseInterest.count({ where: { courseId: d.course.id, notifiedAt: null } }),
    ]);
    const waiting = waitlisted + interested;
    if (!waiting) return { hits: [] };
    // At most once a day while it stays true.
    return {
      hits: [{ key: `day:${isoDay(d.t)}`, userId: null, label: `${free}/${waiting}`, subject: 'seats', alert: true }],
      alert: () => alertTexts.seatOpen(d.names, free, waiting),
      link: { admin: 'applications', teach: 'applications' },
    };
  },

  async APPLICATION_IDLE(d, p) {
    const days = n(p, 'days');
    const hits = (await d.applications(['SUBMITTED']))
      .filter((a) => d.t - a.since >= days * DAY)
      .map((a): Hit => ({ key: a.id, userId: null, label: a.label, subject: a.id, alert: true }));
    return { hits, alert: (c) => alertTexts.applicationIdle(d.names, c, days), link: { admin: 'applications', teach: 'applications' } };
  },

  async CAPACITY(d, p) {
    const percent = n(p, 'percent');
    if (!d.course.capacity) return { hits: [] };
    const taken = await d.seatsTaken();
    const share = (taken / d.course.capacity) * 100;
    const full = taken >= d.course.capacity;
    const hits: Hit[] = [];
    if (share >= percent) hits.push({ key: `p${percent}`, userId: null, label: `${percent}%`, subject: `p${percent}`, alert: true });
    if (full) hits.push({ key: 'full', userId: null, label: 'full', subject: 'full', alert: true });
    return { hits, alert: () => alertTexts.capacity(d.names, percent, full), link: { admin: 'applications', teach: 'applications' } };
  },

  async PROOF_WAITING(d, p) {
    const hours = n(p, 'hours');
    const rows = await d.prisma.payment.findMany({
      where: { status: 'PENDING_REVIEW', application: { courseId: d.course.id }, createdAt: { lte: new Date(d.t - hours * HOUR) } },
      select: { id: true },
    });
    const hits = rows.map((r): Hit => ({ key: r.id, userId: null, label: r.id, subject: r.id, alert: true }));
    // Payments are reviewed by FINANCE in Admin → Payments, never by course staff.
    return { hits, alert: (c) => alertTexts.proofWaiting(d.names, c, hours), link: { admin: '/admin/payments', teach: null } };
  },

  // ------------------------------------------------------------------ course operations
  async WELCOME(d, p) {
    const days = n(p, 'days');
    const start = await d.start();
    if (start === null || start < d.t || start > d.t + days * DAY) return { hits: [] };
    const students = await d.students();
    const drive = d.course.recordingsPlatform === 'GOOGLE_DRIVE';
    const hits = students.map(
      (s): Hit => ({
        key: s.userId,
        userId: s.userId,
        label: s.label,
        message: msg(
          studentTexts.welcome(
            d.names,
            { en: formatStart(new Date(start), 'en', s.timezone), ar: formatStart(new Date(start), 'ar', s.timezone) },
            { telegram: !s.telegram, google: s.googleEmail, drive },
          ),
          d.learn(),
        ),
      }),
    );
    return { hits };
  },

  async NO_LIVE_LINK(d, p) {
    const hours = n(p, 'hours');
    const hits = (await d.sessions())
      .filter((s) => s.start > d.t && s.start <= d.t + hours * HOUR && !s.liveUrl)
      .map((s): Hit => ({ key: s.id, userId: null, label: `${s.order}. ${s.titleEn}`, subject: `${s.order}. ${s.titleEn}`, alert: true }));
    return { hits, alert: (c) => alertTexts.noLiveLink(d.names, c), link: { admin: 'sessions', teach: 'sessions' } };
  },

  async NO_MATERIALS(d, p) {
    const hours = n(p, 'hours');
    const hits = (await d.sessions())
      .filter((s) => s.start > d.t && s.start <= d.t + hours * HOUR && !s.hasMaterials)
      .map((s): Hit => ({ key: s.id, userId: null, label: `${s.order}. ${s.titleEn}`, subject: `${s.order}. ${s.titleEn}`, alert: true }));
    return { hits, alert: (c) => alertTexts.noMaterials(d.names, c), link: { admin: 'sessions', teach: 'materials' } };
  },

  async NO_RECORDING(d, p) {
    const hours = n(p, 'hours');
    const hits = (await d.sessions())
      .filter((s) => s.end <= d.t - hours * HOUR && s.end >= d.t - 14 * DAY && !s.recordingUrl)
      .map((s): Hit => ({ key: s.id, userId: null, label: `${s.order}. ${s.titleEn}`, subject: `${s.order}. ${s.titleEn}`, alert: true }));
    return { hits, alert: (c) => alertTexts.noRecording(d.names, c), link: { admin: 'sessions', teach: 'materials' } };
  },

  async MIDCOURSE_CHECKIN(d) {
    const sessions = await d.sessions();
    const ended = sessions.filter((s) => s.end <= d.t).length;
    if (sessions.length < 3 || ended < Math.ceil(sessions.length / 2) || ended >= sessions.length) return { hits: [] };
    const hits = (await d.students()).map((s): Hit => ({ key: s.userId, userId: s.userId, label: s.label, message: msg(studentTexts.midcourse(d.names), d.learn('#sessions')) }));
    return { hits };
  },

  async WRAP_UP(d) {
    const sessions = await d.sessions();
    const last = sessions[sessions.length - 1];
    if (!last || last.end > d.t - DAY || last.end < d.t - 30 * DAY) return { hits: [] };
    const hits = (await d.students()).map((s): Hit => ({ key: s.userId, userId: s.userId, label: s.label, message: msg(studentTexts.wrapUp(d.names), d.learn('#course-feedback')) }));
    return { hits };
  },

  // ------------------------------------------------------------------ community
  async COMMUNITY_LINKS(d, p) {
    const links = { telegram: String(p.telegramUrl ?? ''), discord: String(p.discordUrl ?? '') };
    if (!links.telegram && !links.discord) return { hits: [] };
    const hits = (await d.students()).map(
      (s): Hit => ({
        key: s.userId,
        userId: s.userId,
        label: s.label,
        message: msg(studentTexts.communityLinks(d.names, links), d.learn(), 'reminders', links.telegram || links.discord),
      }),
    );
    return { hits };
  },

  async TELEGRAM_MISSING(d, p) {
    const days = n(p, 'days');
    const hits = (await d.students())
      .filter((s) => !s.telegram && s.enrolledAt.getTime() <= d.t - days * DAY)
      .map((s): Hit => ({ key: s.userId, userId: s.userId, label: s.label, message: msg(studentTexts.telegramMissing(d.names), '/profile?tab=community') }));
    return { hits };
  },

  async WEEKLY_SUMMARY(d) {
    const [start, end, students] = await Promise.all([d.start(), d.end(), d.students()]);
    if (start === null || start > d.t || (end !== null && end < d.t - 7 * DAY) || !students.length) return { hits: [] };
    // Last full week (Monday to Monday, UTC).
    const week = weekIndex(d.t) - 1;
    const from = week * 7 * DAY - 3 * DAY;
    const entries = await d.prisma.pointsEntry.findMany({
      where: { courseId: d.course.id, voidedAt: null, userId: { in: students.map((s) => s.userId) } },
      select: { userId: true, points: true, createdAt: true },
    });
    const total = new Map<string, number>();
    const last = new Map<string, number>();
    for (const e of entries) {
      total.set(e.userId, (total.get(e.userId) ?? 0) + e.points);
      const t = e.createdAt.getTime();
      if (t >= from && t < from + 7 * DAY) last.set(e.userId, (last.get(e.userId) ?? 0) + e.points);
    }
    const ranked = [...students].sort((a, b) => (total.get(b.userId) ?? 0) - (total.get(a.userId) ?? 0));
    const hits: Hit[] = [];
    ranked.forEach((s, i) => {
      const gained = last.get(s.userId) ?? 0;
      // Only good news: students who earned nothing last week get no message.
      if (gained <= 0) return;
      hits.push({
        key: `${s.userId}:w${week}`,
        userId: s.userId,
        label: s.label,
        message: msg(studentTexts.weeklySummary(d.names, gained, i + 1, ranked.length), d.learn('#leaderboard')),
      });
    });
    return { hits };
  },
};
