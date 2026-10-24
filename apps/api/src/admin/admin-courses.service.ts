import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STATUSES,
  confirmMatches,
  courseInputSchema,
  slugify,
  toCsv,
  type CourseInput,
  type InstructorInput,
  type QuestionInput,
  type SessionInput,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { copyStaff, ensureBuiltinRoles, setCourseInstructors } from '../course-staff/staff-sync';
import { NO_SEATS, toInstructorDto, type SeatCount } from '../courses/course.mapper';
import { CoursesService } from '../courses/courses.service';
import { completedSessionsBy } from '../attendance/completed-sessions';
import { PrismaService } from '../prisma/prisma.service';

type Json = Prisma.InputJsonValue;

/**
 * A free speaker slug from the name: "aya-nasser-salama", then "aya-nasser-salama-2", ...
 * (shared by the speaker editor and the speaker-application approval).
 */
export async function freeInstructorSlug(prisma: Prisma.TransactionClient, name: string, exceptId?: string): Promise<string> {
  const base = slugify(name) || 'speaker';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await prisma.instructor.findFirst({ where: { slug: candidate, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (!taken) return candidate;
  }
}

/**
 * The admin's enrolled total: always the number (even when the course hides it publicly) and
 * seats left by the public rule (capacity minus seats held), null without a capacity.
 */
export function enrolledTotals(capacity: number | null, seats: SeatCount): { enrolledCount: number; seatsLeft: number | null } {
  return { enrolledCount: seats.enrolled, seatsLeft: capacity === null ? null : Math.max(0, capacity - seats.taken) };
}

@Injectable()
export class AdminCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CoursesService,
  ) {}

  async list() {
    const courses = await this.prisma.course.findMany({
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      include: { _count: { select: { sessions: true } } },
    });
    // One batched count for every course (no per-row queries): the same number as the public
    // "N students enrolled", shown to admins whatever the course's showEnrolledCount says.
    const [counts, seats] = await Promise.all([
      this.prisma.application.groupBy({ by: ['courseId', 'status'], _count: { _all: true } }),
      this.catalog.seatCounts(courses.map((c) => c.id)),
    ]);
    return courses.map((c) => ({
      id: c.id,
      slug: c.slug,
      titleEn: c.titleEn,
      titleAr: c.titleAr,
      type: c.type,
      status: c.status,
      source: c.source,
      startDate: c.startDate?.toISOString() ?? null,
      capacity: c.capacity,
      enrolledCount: (seats.get(c.id) ?? NO_SEATS).enrolled,
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
    const seats = (await this.catalog.seatCounts([id])).get(id) ?? NO_SEATS;
    return {
      ...course,
      ...enrolledTotals(course.capacity, seats),
      // The Main instructor and Co-instructors with a speaker profile, shown or anonymous (the
      // Instructors field edits these; everything else about staff is in the Staff tab).
      instructorIds: await this.instructorIds(id),
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

  /** The course editor's Instructors field: a shortcut to the Main instructor and Co-instructor roles of the course staff. */
  private async setInstructors(tx: Prisma.TransactionClient, courseId: string, ids: string[]) {
    await setCourseInstructors(tx, courseId, ids);
  }

  /** What the Instructors field shows: the profiles in the Main instructor and Co-instructor roles, in order. */
  async instructorIds(courseId: string, tx: Prisma.TransactionClient = this.prisma): Promise<string[]> {
    const rows = await tx.courseStaff.findMany({
      where: { courseId, instructorId: { not: null }, role: { builtin: { in: ['MAIN', 'CO'] } } },
      select: { instructorId: true, order: true, role: { select: { order: true } } },
    });
    return rows.sort((a, b) => a.role.order - b.role.order || a.order - b.order).map((r) => r.instructorId!);
  }

  /**
   * An admin change to a course or its lessons takes it over from the archive import, which
   * then never touches it again (see prisma/import-archive.ts). Cheap: a no-op for most courses.
   */
  private async takeOver(courseId: string, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.course.updateMany({ where: { id: courseId, importHash: { not: null } }, data: { importHash: null } });
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
        await ensureBuiltinRoles(tx, created.id);
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
        await tx.course.update({ where: { id }, data: { ...data, importHash: null } });
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
   * Course staff with EDIT_COURSE (Teaching → {course} → Details): the same editor, except what
   * stays with the admins: the status (publishing, archiving), the address (slug), the price and
   * type, and who teaches it (the Staff tab). Those keep their stored values whatever is sent; the
   * result is validated again as a whole (e.g. Arabic texts on a published course).
   */
  async updateAsStaff(id: string, input: CourseInput, actor: Actor) {
    const cur = await this.prisma.course.findUnique({ where: { id }, select: { status: true, slug: true, type: true, price: true, currency: true } });
    if (!cur) throw new NotFoundException('Course not found');
    const merged = courseInputSchema.safeParse({ ...input, ...cur, instructorIds: await this.instructorIds(id) });
    if (!merged.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return this.update(id, merged.data, actor);
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
    try {
      await this.prisma.course.delete({ where: { id } });
    } catch (err) {
      // An application arrived since the check (the foreign key blocks the delete), or it's already gone.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException({ code: 'COURSE_HAS_APPLICANTS', message: 'This course has applicants or students, so it can only be archived.' });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundException('Course not found');
      throw err;
    }
    await this.audit.log({ actorId: admin.id, action: 'course.deleted', entityType: 'Course', entityId: id, metadata: { slug: c.slug } });
  }

  /** Hides a course from the catalog without touching its records. */
  async archive(id: string, admin: Actor) {
    const before = await this.prisma.course.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw new NotFoundException('Course not found');
    if (before.status === 'ARCHIVED') return;
    await this.prisma.course.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date(), importHash: null } });
    // The previous status says what to restore if this was a mistake.
    await this.audit.log({ actorId: admin.id, action: 'course.archived', entityType: 'Course', entityId: id, metadata: { from: before.status } });
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
      topics: s.topics,
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
      await this.takeOver(courseId, tx);
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
      await this.takeOver(courseId, tx);
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
            // The next cohort of a completed course is a new run, entered by an admin.
            endDate: null,
            cohortNumber: fields.cohortNumber ? fields.cohortNumber + 1 : null,
            externalPlatform: null,
            externalUrl: null,
            publicRecordings: false,
            source: null,
            importHash: null,
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
        // The same roles and people (the next cohort usually has the same team; remove anyone in the Staff tab).
        await copyStaff(tx, courseId, created.id);
        if (!(await tx.courseStaff.count({ where: { courseId: created.id } }))) {
          await this.setInstructors(tx, created.id, instructors.sort((a, b) => a.order - b.order).map((i) => i.instructorId));
        }
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
    await this.takeOver(courseId);
    await this.audit.log({ actorId: admin.id, action: 'session.updated', entityType: 'CourseSession', entityId: sessionId });
    return this.prisma.courseSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  async deleteSession(courseId: string, sessionId: string, admin: Actor) {
    const r = await this.prisma.courseSession.deleteMany({ where: { id: sessionId, courseId } });
    if (!r.count) throw new NotFoundException('Session not found');
    await this.takeOver(courseId);
    await this.audit.log({ actorId: admin.id, action: 'session.deleted', entityType: 'CourseSession', entityId: sessionId });
  }

  async reorderSessions(courseId: string, ids: string[]) {
    await this.takeOver(courseId);
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.courseSession.updateMany({ where: { id, courseId }, data: { order: i + 1 } })),
    );
    return this.prisma.courseSession.findMany({ where: { courseId }, orderBy: { order: 'asc' } });
  }

  // ------------------------------------------------------------------ instructors

  /** Every instructor/speaker, with where they appear and whether the archive import created them. */
  async instructors() {
    const list = await this.prisma.instructor.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { courses: true, events: true } } },
    });
    return list.map((i) => ({ ...toInstructorDto(i), source: i.source, courses: i._count.courses, events: i._count.events }));
  }

  async instructor(id: string) {
    const i = await this.prisma.instructor.findUnique({
      where: { id },
      include: {
        _count: { select: { courses: true, events: true } },
        // The speaker account behind the profile, and its application (editable by the team).
        user: { select: { id: true, deletedAt: true, speakerApplication: { select: { id: true } } } },
      },
    });
    if (!i) throw new NotFoundException('Instructor not found');
    const account = i.user && !i.user.deletedAt ? i.user : null;
    return {
      ...toInstructorDto(i),
      source: i.source,
      courses: i._count.courses,
      events: i._count.events,
      previousSlugs: i.previousSlugs,
      userId: account?.id ?? null,
      applicationId: account?.speakerApplication?.id ?? null,
    };
  }

  private freeSlug(name: string, exceptId?: string): Promise<string> {
    return freeInstructorSlug(this.prisma, name, exceptId);
  }

  async saveInstructor(input: InstructorInput, admin: Actor, id?: string) {
    const current = id ? await this.prisma.instructor.findUnique({ where: { id }, select: { slug: true, previousSlugs: true } }) : null;
    if (id && !current) throw new NotFoundException('Instructor not found');
    const data = {
      // Keep the page address stable: an empty field keeps the current slug, or makes one from the name.
      slug: input.slug ?? current?.slug ?? (await this.freeSlug(input.name, id)),
      name: input.name,
      nameAr: input.nameAr ?? null,
      titleEn: input.titleEn,
      titleAr: input.titleAr ?? null,
      bioEn: input.bioEn,
      bioAr: input.bioAr ?? null,
      photoUrl: input.photoUrl ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      githubUrl: input.githubUrl ?? null,
    };
    // A new address: the old one redirects to it (kept in previousSlugs), and nobody else
    // keeps redirecting from the new one.
    const moved = Boolean(current?.slug && data.slug !== current.slug);
    const previousSlugs = moved ? [...new Set([current!.slug!, ...current!.previousSlugs])].filter((x) => x !== data.slug).slice(0, 20) : (current?.previousSlugs ?? []).filter((x) => x !== data.slug);
    let saved;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const others = await tx.instructor.findMany({ where: { previousSlugs: { has: data.slug }, ...(id ? { id: { not: id } } : {}) }, select: { id: true, previousSlugs: true } });
        for (const o of others) await tx.instructor.update({ where: { id: o.id }, data: { previousSlugs: o.previousSlugs.filter((x) => x !== data.slug) } });
        // An admin save takes the speaker over from the archive import (it never touches them again).
        return id
          ? tx.instructor.update({ where: { id }, data: { ...data, previousSlugs, importHash: null } })
          : tx.instructor.create({ data });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'SLUG_TAKEN', message: 'Another speaker already uses this slug' });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundException('Instructor not found');
      throw err;
    }
    await this.audit.log({
      actorId: admin.id,
      action: id ? 'instructor.updated' : 'instructor.created',
      entityType: 'Instructor',
      entityId: saved.id,
      ...(moved ? { metadata: { slugChanged: true } } : {}),
    });
    return toInstructorDto(saved);
  }

  /**
   * Deletes a speaker's public profile. Their sessions stay (shown without a speaker link),
   * they leave the courses and guest lists they were on, and a speaker account behind the
   * profile stays (a student or speaker account, unlinked). Typed confirmation: the name.
   */
  async deleteInstructor(id: string, confirm: string, admin: Actor): Promise<{ events: number; courses: number }> {
    const i = await this.prisma.instructor.findUnique({ where: { id }, include: { _count: { select: { courses: true, events: true, coSpeaking: true } } } });
    if (!i) throw new NotFoundException('Instructor not found');
    if (!confirmMatches(confirm, i.name)) {
      throw new BadRequestException({ code: 'CONFIRM_MISMATCH', message: "Type the speaker's name exactly to delete the profile" });
    }
    // Consultation bookings are kept for accounting, so a profile that has any can't go (unlist it instead).
    if (await this.prisma.consultationBooking.count({ where: { consultant: { instructorId: id } } })) {
      throw new ConflictException({ code: 'HAS_CONSULTATIONS', message: 'This speaker has consultation bookings: unlist them in Admin → Consultations instead of deleting the profile' });
    }
    const reopened = await this.prisma.$transaction(async (tx) => {
      await tx.instructor.delete({ where: { id } });
      // A speaker account loses its profile: an approved application goes back to "Under review",
      // so the team can approve it again (which creates a new profile) if they should keep booking.
      if (!i.userId) return 0;
      const r = await tx.speakerApplication.updateMany({ where: { userId: i.userId, status: 'APPROVED' }, data: { status: 'SUBMITTED', reviewedAt: null, reviewedById: null } });
      return r.count;
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'instructor.deleted',
      entityType: 'Instructor',
      entityId: id,
      metadata: { events: i._count.events, courses: i._count.courses, guestOf: i._count.coSpeaking, hadAccount: Boolean(i.userId), applicationReopened: reopened > 0 },
    });
    return { events: i._count.events, courses: i._count.courses };
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
    // Sessions attended (Present or Partial), plus any marked done before that box was retired.
    const done = new Map([...(await completedSessionsBy(this.prisma, courseId, rows.map((r) => r.userId)))].map(([userId, set]) => [userId, set.size]));
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
