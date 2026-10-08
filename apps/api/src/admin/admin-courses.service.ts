import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STATUSES,
  toCsv,
  type CourseInput,
  type InstructorInput,
  type QuestionInput,
  type SessionInput,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { toInstructorDto } from '../courses/course.mapper';
import { PrismaService } from '../prisma/prisma.service';

type Json = Prisma.InputJsonValue;

@Injectable()
export class AdminCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const courses = await this.prisma.course.findMany({
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      include: { _count: { select: { enrollments: true, sessions: true } } },
    });
    const counts = await this.prisma.application.groupBy({ by: ['courseId', 'status'], _count: { _all: true } });
    return courses.map((c) => ({
      id: c.id,
      slug: c.slug,
      titleEn: c.titleEn,
      titleAr: c.titleAr,
      type: c.type,
      status: c.status,
      startDate: c.startDate?.toISOString() ?? null,
      capacity: c.capacity,
      enrollments: c._count.enrollments,
      sessions: c._count.sessions,
      applications: Object.fromEntries(
        APPLICATION_STATUSES.map((s) => [s, counts.find((x) => x.courseId === c.id && x.status === s)?._count._all ?? 0]),
      ),
    }));
  }

  async get(id: string) {
    const c = await this.prisma.course.findUnique({
      where: { id },
      include: {
        instructors: { orderBy: { order: 'asc' }, include: { instructor: true } },
        screeningQuestions: { orderBy: { order: 'asc' } },
        sessions: { orderBy: { order: 'asc' } },
      },
    });
    if (!c) throw new NotFoundException('Course not found');
    const { instructors, screeningQuestions, sessions, ...course } = c;
    return {
      ...course,
      instructorIds: instructors.map((i) => i.instructorId),
      instructors: instructors.map((i) => toInstructorDto(i.instructor)),
      questions: screeningQuestions,
      sessions,
    };
  }

  private data(input: CourseInput) {
    const { instructorIds: _ids, ...rest } = input;
    return {
      ...rest,
      targetAudience: rest.targetAudience as Json,
      notFor: rest.notFor as Json,
      preparation: rest.preparation as Json,
      learningOutcomes: rest.learningOutcomes as Json,
      prerequisites: rest.prerequisites as Json,
      outline: rest.outline as Json,
      faq: rest.faq as Json,
      included: rest.included as Json,
      archivedAt: rest.status === 'ARCHIVED' ? new Date() : null,
    };
  }

  private async setInstructors(tx: Prisma.TransactionClient, courseId: string, ids: string[]) {
    await tx.courseInstructor.deleteMany({ where: { courseId } });
    if (ids.length) {
      await tx.courseInstructor.createMany({ data: ids.map((instructorId, order) => ({ courseId, instructorId, order })) });
    }
  }

  private slugTaken(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException({ code: 'SLUG_TAKEN', message: 'Another course already uses this slug' });
    }
    throw err;
  }

  async create(input: CourseInput, admin: Actor) {
    try {
      const course = await this.prisma.$transaction(async (tx) => {
        const created = await tx.course.create({ data: this.data(input) });
        await this.setInstructors(tx, created.id, input.instructorIds);
        return created;
      });
      await this.audit.log({ actorId: admin.id, action: 'course.created', entityType: 'Course', entityId: course.id });
      return this.get(course.id);
    } catch (err) {
      this.slugTaken(err);
    }
  }

  async update(id: string, input: CourseInput, admin: Actor) {
    const before = await this.prisma.course.findUnique({ where: { id }, select: { status: true, slug: true, archivedAt: true } });
    if (!before) throw new NotFoundException('Course not found');
    try {
      await this.prisma.$transaction(async (tx) => {
        const data = this.data(input);
        // Keep the original archive date when it stays archived.
        if (input.status === 'ARCHIVED' && before.archivedAt) data.archivedAt = before.archivedAt;
        await tx.course.update({ where: { id }, data });
        await this.setInstructors(tx, id, input.instructorIds);
      });
    } catch (err) {
      this.slugTaken(err);
    }
    await this.audit.log({
      actorId: admin.id,
      action: 'course.updated',
      entityType: 'Course',
      entityId: id,
      metadata: before.status !== input.status ? { from: before.status, to: input.status } : {},
    });
    return this.get(id);
  }

  /**
   * Deletes a course nobody has applied to (e.g. a mistake or a test). Courses with
   * applicants or students keep their records: archive those instead.
   */
  async remove(id: string, admin: Actor) {
    const c = await this.prisma.course.findUnique({
      where: { id },
      select: { slug: true, _count: { select: { applications: true, enrollments: true } } },
    });
    if (!c) throw new NotFoundException('Course not found');
    if (c._count.applications || c._count.enrollments) {
      throw new ConflictException({
        code: 'COURSE_HAS_APPLICANTS',
        message: 'This course has applicants or students, so it can only be archived (their records are kept).',
      });
    }
    await this.prisma.course.delete({ where: { id } });
    await this.audit.log({ actorId: admin.id, action: 'course.deleted', entityType: 'Course', entityId: id, metadata: { slug: c.slug } });
  }

  /** Hides a course from the catalog without touching its records. */
  async archive(id: string, admin: Actor) {
    const r = await this.prisma.course.updateMany({ where: { id, status: { not: 'ARCHIVED' } }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    if (!r.count) {
      if (!(await this.prisma.course.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Course not found');
      return;
    }
    await this.audit.log({ actorId: admin.id, action: 'course.archived', entityType: 'Course', entityId: id });
  }

  /** Replaces the question list; existing questions keep their ids so stored answers stay readable. */
  async setQuestions(courseId: string, questions: QuestionInput[], admin: Actor) {
    await this.ensure(courseId);
    await this.prisma.$transaction(async (tx) => {
      const keep = questions.map((q) => q.id).filter((x): x is string => Boolean(x));
      const removed = await tx.screeningQuestion.findMany({ where: { courseId, id: { notIn: keep } }, select: { id: true } });
      // Answers are stored by question id: deleting an answered question would hide them for good.
      for (const { id } of removed) {
        const [row] = await tx.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM "Application" WHERE "courseId" = ${courseId} AND jsonb_exists(answers, ${id})`;
        if ((row?.n ?? 0n) > 0n) {
          throw new ConflictException({
            code: 'QUESTION_ANSWERED',
            message: 'A question that applicants already answered can’t be deleted. Make it optional instead.',
          });
        }
      }
      await tx.screeningQuestion.deleteMany({ where: { courseId, id: { in: removed.map((r) => r.id) } } });
      for (const [order, q] of questions.entries()) {
        const data = {
          type: q.type,
          labelEn: q.labelEn,
          labelAr: q.labelAr,
          helpEn: q.helpEn ?? null,
          helpAr: q.helpAr ?? null,
          options: (q.type === 'SINGLE_SELECT' || q.type === 'MULTI_SELECT' ? (q.options ?? []) : Prisma.JsonNull) as Json,
          required: q.required,
          order,
        };
        if (q.id) await tx.screeningQuestion.updateMany({ where: { id: q.id, courseId }, data });
        else await tx.screeningQuestion.create({ data: { ...data, courseId } });
      }
    });
    await this.audit.log({ actorId: admin.id, action: 'course.questions_updated', entityType: 'Course', entityId: courseId });
    return (await this.get(courseId)).questions;
  }

  private async ensure(courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!c) throw new NotFoundException('Course not found');
  }

  private sessionData(s: SessionInput) {
    return {
      titleEn: s.titleEn,
      titleAr: s.titleAr,
      descriptionEn: s.descriptionEn ?? null,
      descriptionAr: s.descriptionAr ?? null,
      startsAt: s.startsAt,
      durationMin: s.durationMin,
      liveUrl: s.liveUrl ?? null,
      recordingUrl: s.recordingUrl ?? null,
      assignmentUrl: s.assignmentUrl ?? null,
      materials: s.materials as Json,
    };
  }

  /** Next free `order`, read under a course row lock so concurrent adds can't collide. */
  private async nextOrder(tx: Prisma.TransactionClient, courseId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Course" WHERE id = ${courseId} FOR NO KEY UPDATE`;
    if (!rows.length) throw new NotFoundException('Course not found');
    const last = await tx.courseSession.aggregate({ where: { courseId }, _max: { order: true } });
    return (last._max.order ?? 0) + 1;
  }

  async createSession(courseId: string, s: SessionInput, admin: Actor) {
    const created = await this.prisma.$transaction(async (tx) => {
      const order = await this.nextOrder(tx, courseId);
      return tx.courseSession.create({ data: { ...this.sessionData(s), courseId, order } });
    });
    await this.audit.log({ actorId: admin.id, action: 'session.created', entityType: 'CourseSession', entityId: created.id });
    return created;
  }

  async createSessions(courseId: string, list: SessionInput[], admin: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const start = await this.nextOrder(tx, courseId);
      await tx.courseSession.createMany({
        data: list.map((s, i) => ({ ...this.sessionData(s), courseId, order: start + i })),
      });
    });
    await this.audit.log({ actorId: admin.id, action: 'session.bulk_created', entityType: 'Course', entityId: courseId, metadata: { count: list.length } });
    return this.prisma.courseSession.findMany({ where: { courseId }, orderBy: { order: 'asc' } });
  }

  /**
   * Copies a course (content, questions, sessions, instructors) as a new DRAFT,
   * e.g. for the next cohort. Applications, enrolments and feedback are not copied.
   */
  async duplicate(courseId: string, input: { slug: string; titleEn: string }, admin: Actor) {
    const src = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { screeningQuestions: true, sessions: true, instructors: true },
    });
    if (!src) throw new NotFoundException('Course not found');
    const { id: _id, createdAt: _c, updatedAt: _u, archivedAt: _a, screeningQuestions, sessions, instructors, ...fields } = src;
    try {
      const copy = await this.prisma.$transaction(async (tx) => {
        const created = await tx.course.create({
          data: {
            ...(fields as unknown as Prisma.CourseCreateInput),
            slug: input.slug,
            titleEn: input.titleEn,
            status: 'DRAFT',
            // Cohort-specific: the new cohort gets its own dates, folder and playlist.
            startDate: null,
            applicationsOpenAt: null,
            applicationDeadline: null,
            driveFolderUrl: null,
            youtubePlaylistUrl: null,
            targetAudience: fields.targetAudience as Json,
            notFor: fields.notFor as Json,
            preparation: fields.preparation as Json,
            learningOutcomes: fields.learningOutcomes as Json,
            prerequisites: fields.prerequisites as Json,
            outline: fields.outline as Json,
            faq: fields.faq as Json,
            included: fields.included as Json,
          },
        });
        if (screeningQuestions.length) {
          await tx.screeningQuestion.createMany({
            data: screeningQuestions.map(({ id: _q, courseId: _cid, ...q }) => ({
              ...q,
              options: (q.options ?? Prisma.JsonNull) as Json,
              courseId: created.id,
            })),
          });
        }
        if (sessions.length) {
          await tx.courseSession.createMany({
            data: sessions.map(({ id: _s, courseId: _cid, createdAt: _sc, updatedAt: _su, ...s }) => ({
              ...s,
              // Links belong to the old cohort (Meet, recordings, quizzes, forms); the new one gets its own.
              materials: [] as Json,
              liveUrl: null,
              recordingUrl: null,
              assignmentUrl: null,
              courseId: created.id,
            })),
          });
        }
        await this.setInstructors(tx, created.id, instructors.sort((a, b) => a.order - b.order).map((i) => i.instructorId));
        return created;
      });
      await this.audit.log({ actorId: admin.id, action: 'course.duplicated', entityType: 'Course', entityId: copy.id, metadata: { from: courseId } });
      return { id: copy.id };
    } catch (err) {
      this.slugTaken(err);
    }
  }

  async updateSession(courseId: string, sessionId: string, s: SessionInput, admin: Actor) {
    const r = await this.prisma.courseSession.updateMany({ where: { id: sessionId, courseId }, data: this.sessionData(s) });
    if (!r.count) throw new NotFoundException('Session not found');
    await this.audit.log({ actorId: admin.id, action: 'session.updated', entityType: 'CourseSession', entityId: sessionId });
    return this.prisma.courseSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  async deleteSession(courseId: string, sessionId: string, admin: Actor) {
    const r = await this.prisma.courseSession.deleteMany({ where: { id: sessionId, courseId } });
    if (!r.count) throw new NotFoundException('Session not found');
    await this.audit.log({ actorId: admin.id, action: 'session.deleted', entityType: 'CourseSession', entityId: sessionId });
  }

  async reorderSessions(courseId: string, ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.courseSession.updateMany({ where: { id, courseId }, data: { order: i + 1 } })),
    );
    return this.prisma.courseSession.findMany({ where: { courseId }, orderBy: { order: 'asc' } });
  }

  // ------------------------------------------------------------------ instructors

  async instructors() {
    const list = await this.prisma.instructor.findMany({ orderBy: { name: 'asc' } });
    return list.map(toInstructorDto);
  }

  async saveInstructor(input: InstructorInput, admin: Actor, id?: string) {
    const data = {
      name: input.name,
      nameAr: input.nameAr ?? null,
      titleEn: input.titleEn,
      titleAr: input.titleAr ?? null,
      bioEn: input.bioEn,
      bioAr: input.bioAr ?? null,
      photoUrl: input.photoUrl ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
    };
    const saved = id
      ? await this.prisma.instructor.update({ where: { id }, data }).catch(() => {
          throw new NotFoundException('Instructor not found');
        })
      : await this.prisma.instructor.create({ data });
    await this.audit.log({ actorId: admin.id, action: id ? 'instructor.updated' : 'instructor.created', entityType: 'Instructor', entityId: saved.id });
    return toInstructorDto(saved);
  }

  // ------------------------------------------------------------------ enrolled students (Risk 1)

  async enrollments(courseId: string, driveAccess?: 'pending' | 'granted') {
    await this.ensure(courseId);
    const total = await this.prisma.courseSession.count({ where: { courseId } });
    const rows = await this.prisma.enrollment.findMany({
      where: {
        courseId,
        // Deleted accounts stay listed while their Google address still has to be removed from the folder.
        OR: [{ user: { deletedAt: null } }, { driveRevokeEmail: { not: null } }],
        ...(driveAccess === 'pending' ? { driveAccessGranted: false } : driveAccess === 'granted' ? { driveAccessGranted: true } : {}),
      },
      orderBy: { enrolledAt: 'asc' },
      include: {
        user: { select: { id: true, email: true, deletedAt: true, profile: { select: { fullNameEn: true, googleEmail: true, phone: true } } } },
      },
    });
    const progress = await this.prisma.sessionProgress.groupBy({
      by: ['userId'],
      where: { userId: { in: rows.map((r) => r.userId) }, session: { courseId } },
      _count: { _all: true },
    });
    const done = new Map(progress.map((p) => [p.userId, p._count._all]));
    return rows.map((e) => {
      // A deleted account shows only the address to remove, nothing else about the person.
      const deleted = Boolean(e.user.deletedAt);
      return {
      id: e.id,
      userId: e.userId,
      deleted,
      name: deleted ? null : (e.user.profile?.fullNameEn ?? null),
      email: deleted ? null : e.user.email,
      googleEmail: deleted ? null : (e.user.profile?.googleEmail ?? null),
      phone: deleted ? null : (e.user.profile?.phone ?? null),
      enrolledAt: e.enrolledAt.toISOString(),
      driveAccessGranted: e.driveAccessGranted,
      driveAccessGrantedAt: e.driveAccessGrantedAt?.toISOString() ?? null,
      /** An address to remove from the folder (changed Google account or deleted student). */
      driveRevokeEmail: e.driveRevokeEmail,
      progress: { completed: done.get(e.userId) ?? 0, total },
      };
    });
  }

  /** The admin removed the old address from the Drive folder. */
  async markDriveRemoved(enrollmentId: string, admin: Actor) {
    const r = await this.prisma.enrollment.updateMany({ where: { id: enrollmentId, driveRevokeEmail: { not: null } }, data: { driveRevokeEmail: null } });
    if (!r.count) throw new NotFoundException('Nothing to remove');
    await this.audit.log({ actorId: admin.id, action: 'enrollment.drive_old_access_removed', entityType: 'Enrollment', entityId: enrollmentId });
  }

  async setDriveAccess(enrollmentId: string, granted: boolean, admin: Actor) {
    const e = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!e) throw new NotFoundException('Enrolment not found');
    const updated = await this.prisma.enrollment.update({
      where: { id: enrollmentId },
      // Marking access as granted also confirms the old address (if any) was removed.
      data: granted
        ? { driveAccessGranted: true, driveAccessGrantedAt: new Date(), driveRevokeEmail: null }
        : { driveAccessGranted: false, driveAccessGrantedAt: null },
    });
    await this.audit.log({
      actorId: admin.id,
      action: granted ? 'enrollment.drive_access_granted' : 'enrollment.drive_access_revoked',
      entityType: 'Enrollment',
      entityId: enrollmentId,
      metadata: { courseId: e.courseId },
    });
    return { id: updated.id, driveAccessGranted: updated.driveAccessGranted, driveRevokeEmail: updated.driveRevokeEmail };
  }

  async enrollmentsCsv(courseId: string, admin: Actor): Promise<string> {
    const rows = await this.enrollments(courseId);
    await this.audit.log({ actorId: admin.id, action: 'enrollments.exported', entityType: 'Course', entityId: courseId, metadata: { count: rows.length } });
    return toCsv(
      ['Name', 'Email', 'Google email', 'Phone', 'Enrolled at', 'Drive access granted', 'Remove from Drive', 'Sessions done', 'Account deleted'],
      rows.map((r) => [r.name, r.email, r.googleEmail, r.phone, r.enrolledAt, r.driveAccessGranted, r.driveRevokeEmail, `${r.progress.completed}/${r.progress.total}`, r.deleted]),
    );
  }

  // ------------------------------------------------------------------ feedback

  async feedback(courseId: string) {
    await this.ensure(courseId);
    const [sessions, rows] = await Promise.all([
      this.prisma.courseSession.findMany({ where: { courseId }, orderBy: { order: 'asc' }, select: { id: true, order: true, titleEn: true, titleAr: true } }),
      this.prisma.sessionFeedback.findMany({ where: { courseId }, orderBy: { createdAt: 'desc' }, include: { user: { select: { profile: { select: { fullNameEn: true } } } } } }),
    ]);
    const summarise = (sessionId: string | null) => {
      const list = rows.filter((r) => r.sessionId === sessionId);
      return {
        count: list.length,
        average: list.length ? Math.round((list.reduce((a, r) => a + r.rating, 0) / list.length) * 10) / 10 : null,
        comments: list
          .filter((r) => r.comment)
          .map((r) => ({ rating: r.rating, comment: r.comment!, by: r.user.profile?.fullNameEn ?? null, at: r.createdAt.toISOString() })),
      };
    };
    return {
      sessions: sessions.map((s) => ({ ...s, ...summarise(s.id) })),
      course: summarise(null),
    };
  }
}
