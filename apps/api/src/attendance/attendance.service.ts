import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  attendancePoints,
  attendanceStatus,
  matchAttendance,
  POINTS_SOURCES,
  toCsv,
  type AttendanceCourseDto,
  type AttendanceMatch,
  type AttendancePreviewDto,
  type AttendanceRowDto,
  type AttendanceSessionDto,
  type AttendanceSessionRefDto,
  type AttendanceSettings,
  type AttendanceSettingsInput,
  type AttendanceStatus,
  type AttendanceUploadInput,
  type MyAttendanceDto,
} from '@academy/shared';
import type { Course, CourseSession, Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { capRows } from '../admin/export';
import { AuditService } from '../audit/audit.service';
import { COUNTED, PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

type Student = { userId: string; email: string; googleEmail: string | null; nameEn: string | null; nameAr: string | null };
type StoredRow = { userId: string; minutes: number; percent: number; status: AttendanceStatus; source: 'CSV' | 'MANUAL'; matchedBy: string | null; updatedAt: Date };

const settingsOf = (c: Pick<Course, 'attendancePresentPercent' | 'attendancePresentPoints' | 'attendancePartialPoints' | 'attendanceAbsentPoints'>): AttendanceSettings => ({
  presentPercent: c.attendancePresentPercent,
  presentPoints: c.attendancePresentPoints,
  partialPoints: c.attendancePartialPoints,
  absentPoints: c.attendanceAbsentPoints,
});

const sessionRef = (s: CourseSession): AttendanceSessionRefDto => ({
  id: s.id,
  order: s.order,
  titleEn: s.titleEn,
  titleAr: s.titleAr || s.titleEn,
  startsAt: s.startsAt.toISOString(),
  durationMin: s.durationMin,
});

const STATUS_WORD: Record<AttendanceStatus, string> = { PRESENT: 'Present', PARTIAL: 'Partial', ABSENT: 'Absent' };

function counts(rows: { status: AttendanceStatus }[]) {
  return {
    present: rows.filter((r) => r.status === 'PRESENT').length,
    partial: rows.filter((r) => r.status === 'PARTIAL').length,
    absent: rows.filter((r) => r.status === 'ABSENT').length,
  };
}

/** "Attendance changed for this session": one at a time, so a re-upload never races a hand edit. */
const lockKey = (sessionId: string) => `attendance:${sessionId}`;

/**
 * Attendance from Google Meet, per course session, and the points it is worth.
 *
 * The browser reads the file (parseAttendanceSheet) and sends the records; here they are
 * matched to the course's enrolled students (matchAttendance), each student gets a status by
 * the course's rule (or this upload's threshold), and a save replaces the session's
 * attendance. Attendance points are a ledger source per (student, session), so a re-upload
 * appends only the difference: never a double award. Unmatched rows are never stored and no
 * account is ever created from a file.
 *
 * Callers check who may do this: admins with ACADEMIC (or SUPER) for every course, speakers for
 * the courses they teach (TeachesCourseGuard). Every id inside the course is checked here.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly points: PointsService,
  ) {}

  private async courseRow(courseId: string): Promise<Course> {
    const c = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  private async sessionIn(courseId: string, sessionId: string): Promise<CourseSession> {
    const s = await this.prisma.courseSession.findFirst({ where: { id: sessionId, courseId } });
    if (!s) throw new NotFoundException('Session not found');
    return s;
  }

  /** Students who count: enrolled, account not deleted. */
  private async enrolled(courseId: string): Promise<Student[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: { courseId, user: { deletedAt: null } },
      orderBy: { enrolledAt: 'asc' },
      take: 5000,
      select: { user: { select: { id: true, email: true, profile: { select: { fullNameEn: true, fullNameAr: true, googleEmail: true } } } } },
    });
    return rows.map(({ user: u }) => ({
      userId: u.id,
      email: u.email,
      googleEmail: u.profile?.googleEmail ?? null,
      nameEn: u.profile?.fullNameEn ?? null,
      nameAr: u.profile?.fullNameAr ?? null,
    }));
  }

  // ------------------------------------------------------------------ the course

  async course(courseId: string): Promise<AttendanceCourseDto> {
    const course = await this.courseRow(courseId);
    const [sessions, students, rows] = await Promise.all([
      this.prisma.courseSession.findMany({ where: { courseId }, orderBy: [{ order: 'asc' }, { startsAt: 'asc' }] }),
      this.enrolled(courseId),
      this.prisma.sessionAttendance.findMany({ where: { session: { courseId }, user: { deletedAt: null } }, select: { sessionId: true, status: true, updatedAt: true } }),
    ]);
    return {
      settings: settingsOf(course),
      students: students.map((s) => ({ userId: s.userId, name: s.nameEn || s.nameAr, email: s.email })),
      sessions: sessions.map((s) => {
        const mine = rows.filter((r) => r.sessionId === s.id);
        const last = mine.reduce<Date | null>((d, r) => (!d || r.updatedAt > d ? r.updatedAt : d), null);
        return { ...sessionRef(s), recorded: mine.length > 0, ...counts(mine), updatedAt: last?.toISOString() ?? null };
      }),
    };
  }

  /** Course settings → Attendance: the threshold and the points per status (admins only). Audited. */
  async updateSettings(courseId: string, input: AttendanceSettingsInput, actor: Actor): Promise<AttendanceSettings> {
    await this.courseRow(courseId);
    const c = await this.prisma.course.update({
      where: { id: courseId },
      data: {
        attendancePresentPercent: input.presentPercent,
        attendancePresentPoints: input.presentPoints,
        attendancePartialPoints: input.partialPoints,
        attendanceAbsentPoints: input.absentPoints,
      },
    });
    await this.audit.log({ actorId: actor.id, action: 'course.attendance_settings_updated', entityType: 'Course', entityId: courseId, metadata: { ...input } });
    return settingsOf(c);
  }

  // ------------------------------------------------------------------ one session

  /** The attendance points each student holds for this session now. */
  private async held(db: Prisma.TransactionClient, sessionId: string, userIds: string[]): Promise<Map<string, number>> {
    const sums = await db.pointsEntry.groupBy({
      by: ['userId'],
      where: { sourceType: POINTS_SOURCES.ATTENDANCE, sourceId: sessionId, userId: { in: userIds }, ...COUNTED },
      _sum: { points: true },
    });
    return new Map(sums.map((s) => [s.userId, s._sum.points ?? 0]));
  }

  private rowDto(s: Student, r: Omit<StoredRow, 'updatedAt'>, settings: AttendanceSettings, held: number, records: number[] = []): AttendanceRowDto {
    const points = attendancePoints(r.status, settings);
    return {
      userId: s.userId,
      name: s.nameEn || s.nameAr,
      email: s.email,
      minutes: r.minutes,
      percent: r.percent,
      status: r.status,
      source: r.source,
      matchedBy: (r.matchedBy as AttendanceMatch | null) ?? null,
      points,
      change: points - held,
      records,
    };
  }

  /** What is stored for the session: one row per enrolled student once attendance is recorded. */
  async session(courseId: string, sessionId: string): Promise<AttendanceSessionDto> {
    const [course, session] = await Promise.all([this.courseRow(courseId), this.sessionIn(courseId, sessionId)]);
    const settings = settingsOf(course);
    const [students, stored] = await Promise.all([this.enrolled(courseId), this.prisma.sessionAttendance.findMany({ where: { sessionId } })]);
    const byUser = new Map(stored.map((r) => [r.userId, r]));
    const held = await this.held(this.prisma, sessionId, students.map((s) => s.userId));
    const rows = students.filter((s) => byUser.has(s.userId)).map((s) => this.rowDto(s, byUser.get(s.userId)!, settings, held.get(s.userId) ?? 0));
    const last = stored.reduce<Date | null>((d, r) => (!d || r.updatedAt > d ? r.updatedAt : d), null);
    return { session: sessionRef(session), settings, presentPercent: settings.presentPercent, rows, recorded: rows.length > 0, updatedAt: last?.toISOString() ?? null, counts: counts(rows) };
  }

  /**
   * Preview (dryRun) or save an uploaded file's attendance. Every enrolled student gets a row:
   * the file's minutes when a record matched them (by email, by name, or by the uploader's
   * pick), 0 minutes (ABSENT) otherwise; a status set by hand in the preview wins. Saving
   * replaces the session's attendance and moves each student's attendance points to what
   * their status is worth now. Audited with ids and counts only.
   */
  async upload(courseId: string, sessionId: string, input: AttendanceUploadInput, actor: Actor, now = new Date()): Promise<AttendancePreviewDto> {
    const [course, session] = await Promise.all([this.courseRow(courseId), this.sessionIn(courseId, sessionId)]);
    const settings = settingsOf(course);
    const presentPercent = input.presentPercent ?? settings.presentPercent;
    const students = await this.enrolled(courseId);
    const byId = new Map(students.map((s) => [s.userId, s]));
    const bad = (path: string, message: string) => new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path, message }] });

    // The uploader's choices must point at this file's records and this course's students.
    for (const a of input.assign) {
      if (a.index >= input.records.length) throw bad('assign', 'Unknown row');
      if (!byId.has(a.userId)) throw bad('assign', 'Not a student of this course');
    }
    if (input.ignore.some((i) => i >= input.records.length)) throw bad('ignore', 'Unknown row');
    for (const s of input.statuses) if (!byId.has(s.userId)) throw bad('statuses', 'Not a student of this course');

    const auto = matchAttendance(
      input.records,
      students.map((s) => ({ userId: s.userId, emails: [s.email, s.googleEmail].filter((e): e is string => Boolean(e)), names: [s.nameEn, s.nameAr].filter((n): n is string => Boolean(n)) })),
    );
    const ignore = new Set(input.ignore);
    const assign = new Map(input.assign.map((a) => [a.index, a.userId]));
    const found = new Map<string, { minutes: number; by: Set<AttendanceMatch>; records: number[] }>();
    const unmatched: AttendancePreviewDto['unmatched'] = [];
    input.records.forEach((rec, index) => {
      if (ignore.has(index)) return;
      const picked = assign.get(index);
      const m = picked ? { userId: picked, by: 'MANUAL' as const } : auto[index];
      if (!m) {
        unmatched.push({ index, name: rec.name, email: rec.email, minutes: rec.minutes });
        return;
      }
      const f = found.get(m.userId) ?? { minutes: 0, by: new Set<AttendanceMatch>(), records: [] };
      f.minutes += rec.minutes;
      f.by.add(m.by);
      f.records.push(index);
      found.set(m.userId, f);
    });
    const byHand = new Map(input.statuses.map((s) => [s.userId, s.status]));

    // A name match is the one to review, so it shows even when an email matched too.
    const matchedBy = (by: Set<AttendanceMatch> | undefined): AttendanceMatch | null => (!by ? null : by.has('NAME') ? 'NAME' : by.has('MANUAL') ? 'MANUAL' : 'EMAIL');
    const planned = students.map((s) => {
      const f = found.get(s.userId);
      const minutes = Math.min(24 * 60, f?.minutes ?? 0);
      const rule = attendanceStatus(minutes, session.durationMin, presentPercent);
      const hand = byHand.get(s.userId);
      return {
        student: s,
        records: f?.records ?? [],
        row: { userId: s.userId, minutes: Math.round(minutes), percent: rule.percent, status: hand ?? rule.status, source: hand ? ('MANUAL' as const) : ('CSV' as const), matchedBy: matchedBy(f?.by) },
      };
    });
    const ids = students.map((s) => s.userId);

    const result = (held: Map<string, number>, dryRun: boolean): AttendancePreviewDto => {
      const rows = planned.map((p) => this.rowDto(p.student, p.row, settings, held.get(p.student.userId) ?? 0, p.records));
      return {
        dryRun,
        session: sessionRef(session),
        settings,
        presentPercent,
        rows,
        recorded: !dryRun,
        updatedAt: dryRun ? null : now.toISOString(),
        counts: counts(rows),
        unmatched,
        ignored: ignore.size,
        pointsChange: rows.reduce((n, r) => n + r.change, 0),
      };
    };

    if (input.dryRun) return result(await this.held(this.prisma, sessionId, ids), true);

    const held = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(sessionId)}))`;
      // Read under the lock: the points each student holds right now, not at preview time.
      const before = await this.held(tx, sessionId, ids);
      // Deleted accounts are left alone: they never gain (or lose) points again, and anonymisation removes theirs.
      const stale = await tx.sessionAttendance.findMany({ where: { sessionId, userId: { notIn: ids }, user: { deletedAt: null } }, select: { userId: true } });
      await tx.sessionAttendance.deleteMany({ where: { sessionId } });
      await tx.sessionAttendance.createMany({ data: planned.map((p) => ({ sessionId, ...p.row, uploadedById: actor.id, createdAt: now, updatedAt: now })) });
      for (const p of planned) {
        await this.points.syncSourceTx(
          tx,
          { userId: p.row.userId, courseId, sourceType: POINTS_SOURCES.ATTENDANCE, sourceId: sessionId, reason: 'ATTENDANCE' },
          attendancePoints(p.row.status, settings),
          now,
        );
      }
      // Someone recorded before who is no longer a student here: their attendance and its points go.
      for (const { userId } of stale) {
        await this.points.syncSourceTx(tx, { userId, courseId, sourceType: POINTS_SOURCES.ATTENDANCE, sourceId: sessionId, reason: 'ATTENDANCE' }, 0, now);
      }
      const c = counts(planned.map((p) => p.row));
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'attendance.uploaded',
          entityType: 'CourseSession',
          entityId: sessionId,
          metadata: { courseId, students: planned.length, ...c, unmatched: unmatched.length, ignored: ignore.size, byHand: byHand.size, presentPercent, removed: stale.length },
        },
        tx,
      );
      return before;
    });
    return result(held, false);
  }

  /** Marks one enrolled student by hand (with or without an upload). Points follow; audited. */
  async mark(courseId: string, sessionId: string, userId: string, status: AttendanceStatus, actor: Actor, now = new Date()): Promise<AttendanceRowDto> {
    const [course, session] = await Promise.all([this.courseRow(courseId), this.sessionIn(courseId, sessionId)]);
    const student = (await this.enrolled(courseId)).find((s) => s.userId === userId);
    if (!student) throw new NotFoundException('Student not found');
    const settings = settingsOf(course);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(sessionId)}))`;
      const prev = await tx.sessionAttendance.findUnique({ where: { sessionId_userId: { sessionId, userId } } });
      const minutes = prev?.minutes ?? 0;
      const percent = prev?.percent ?? attendanceStatus(minutes, session.durationMin, settings.presentPercent).percent;
      const row = await tx.sessionAttendance.upsert({
        where: { sessionId_userId: { sessionId, userId } },
        update: { status, source: 'MANUAL', uploadedById: actor.id },
        create: { sessionId, userId, minutes, percent, status, source: 'MANUAL', matchedBy: null, uploadedById: actor.id },
      });
      const held = (await this.held(tx, sessionId, [userId])).get(userId) ?? 0;
      await this.points.syncSourceTx(tx, { userId, courseId, sourceType: POINTS_SOURCES.ATTENDANCE, sourceId: sessionId, reason: 'ATTENDANCE' }, attendancePoints(status, settings), now);
      await this.audit.log(
        { actorId: actor.id, action: 'attendance.marked', entityType: 'CourseSession', entityId: sessionId, metadata: { courseId, userId, status, from: prev?.status ?? null } },
        tx,
      );
      return this.rowDto(student, row, settings, held);
    });
  }

  // ------------------------------------------------------------------ export and the learn page

  /** Sessions × students: each cell is the status and minutes. Audited. */
  async csv(courseId: string, actor: Actor): Promise<string> {
    await this.courseRow(courseId);
    const [sessions, students, rows, pts] = await Promise.all([
      this.prisma.courseSession.findMany({ where: { courseId }, orderBy: [{ order: 'asc' }, { startsAt: 'asc' }] }),
      this.enrolled(courseId),
      this.prisma.sessionAttendance.findMany({ where: { session: { courseId } }, select: { sessionId: true, userId: true, status: true, minutes: true } }),
      this.prisma.pointsEntry.groupBy({ by: ['userId'], where: { courseId, sourceType: POINTS_SOURCES.ATTENDANCE, ...COUNTED }, _sum: { points: true } }),
    ]);
    const cell = new Map(rows.map((r) => [`${r.sessionId}:${r.userId}`, r]));
    const points = new Map(pts.map((p) => [p.userId, p._sum.points ?? 0]));
    await this.audit.log({ actorId: actor.id, action: 'attendance.exported', entityType: 'Course', entityId: courseId, metadata: { sessions: sessions.length, students: students.length } });
    return toCsv(
      ['Name', 'Email', ...sessions.map((s) => `${s.order}. ${s.titleEn}`), 'Present', 'Partial', 'Absent', 'Attendance points'],
      capRows(students, (s) => {
        const mine = sessions.map((x) => cell.get(`${x.id}:${s.userId}`));
        const n = (st: AttendanceStatus) => mine.filter((r) => r?.status === st).length;
        return [
          s.nameEn || s.nameAr || '',
          s.email,
          ...mine.map((r) => (!r ? '' : r.status === 'ABSENT' ? STATUS_WORD.ABSENT : `${STATUS_WORD[r.status]} (${r.minutes} min)`)),
          n('PRESENT'),
          n('PARTIAL'),
          n('ABSENT'),
          points.get(s.userId) ?? 0,
        ];
      }),
    );
  }

  /** A student's own attendance per session (the learn page). */
  async mine(userId: string, sessionIds: string[]): Promise<Map<string, MyAttendanceDto>> {
    if (!sessionIds.length) return new Map();
    const rows = await this.prisma.sessionAttendance.findMany({ where: { userId, sessionId: { in: sessionIds } }, select: { sessionId: true, status: true, minutes: true, percent: true } });
    return new Map(rows.map((r) => [r.sessionId, { status: r.status, minutes: r.minutes, percent: r.percent }]));
  }
}
