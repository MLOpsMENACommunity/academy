import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  countedAttempt,
  toCsv,
  type AdminAssessmentDto,
  type AdminAssessmentRow,
  type AdminSubmissionDto,
  type AssessmentInput,
  type GradebookRow,
  type GradeInput,
  type QuizQuestionInput,
  type SubmissionFilter,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SIGNED_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import { capRows } from '../admin/export';
import { PointsService } from '../points/points.service';
import { AssessmentsService, buildReview } from './assessments.service';
import { formatDueAt } from './due-format';

const questionsInclude = { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } as const;

/** Saving a long quiz is many statements: more than Prisma's 5-second default. */
const QUESTIONS_TX_TIMEOUT_MS = 30_000;

/** Would writing `data` change `row`? */
function changed(row: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return Object.entries(data).some(([k, v]) => row[k] !== v);
}

/** Leaves a key out when its value is undefined: Prisma then keeps what is stored. */
function defined<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

/**
 * The assessment's own fields (everything but the questions). The admin editor is
 * English-only: Arabic wording and the order are absent unless sent, and absent
 * fields keep their stored values (create() fills in '' and the next position).
 */
function fields(input: AssessmentInput) {
  const quiz = input.type === 'QUIZ';
  return {
    ...defined({ order: input.order, titleAr: input.titleAr, instructionsAr: input.instructionsAr }),
    type: input.type,
    status: input.status,
    sessionId: input.sessionId,
    titleEn: input.titleEn,
    instructionsEn: input.instructionsEn,
    dueAt: input.dueAt,
    allowLate: input.allowLate,
    maxPoints: input.maxPoints,
    passPercent: input.passPercent,
    countsForCertificate: input.countsForCertificate,
    submissionKind: quiz ? null : input.submissionKind,
    attemptsAllowed: quiz ? input.attemptsAllowed : 1,
    scoring: input.scoring,
    revealAnswers: input.revealAnswers,
    timeLimitMin: quiz ? input.timeLimitMin : null,
    shuffle: quiz ? input.shuffle : false,
  };
}

/** Admin side: the Assessments tab of the course editor and the gradebook. */
@Injectable()
export class AdminAssessmentsService {
  private readonly logger = new Logger(AdminAssessmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly assessments: AssessmentsService,
    private readonly points: PointsService,
  ) {}

  private async course(courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  private async checkSession(courseId: string, sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    const s = await this.prisma.courseSession.findFirst({ where: { id: sessionId, courseId }, select: { id: true } });
    if (!s) throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: 'sessionId', message: 'Not a session of this course' }] });
  }

  async list(courseId: string): Promise<AdminAssessmentRow[]> {
    await this.course(courseId);
    const items = await this.prisma.assessment.findMany({
      where: { courseId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { questions: true } } },
    });
    const counts = await this.prisma.submission.groupBy({
      by: ['assessmentId', 'userId'],
      where: { assessmentId: { in: items.map((a) => a.id) }, submittedAt: { not: null } },
      _count: { _all: true },
    });
    const pending = await this.prisma.submission.groupBy({
      by: ['assessmentId'],
      where: { assessmentId: { in: items.map((a) => a.id) }, submittedAt: { not: null }, gradedAt: null },
      _count: { _all: true },
    });
    return items.map((a) => ({
      id: a.id,
      sessionId: a.sessionId,
      type: a.type,
      status: a.status,
      order: a.order,
      titleEn: a.titleEn,
      titleAr: a.titleAr,
      dueAt: a.dueAt?.toISOString() ?? null,
      maxPoints: a.maxPoints,
      countsForCertificate: a.countsForCertificate,
      submissionKind: a.submissionKind,
      questionCount: a._count.questions,
      submitted: counts.filter((c) => c.assessmentId === a.id).length,
      toGrade: pending.find((p) => p.assessmentId === a.id)?._count._all ?? 0,
    }));
  }

  async get(id: string): Promise<AdminAssessmentDto> {
    const a = await this.prisma.assessment.findUnique({ where: { id }, include: { ...questionsInclude, _count: { select: { submissions: true } } } });
    if (!a) throw new NotFoundException('Assessment not found');
    const { questions, _count, createdAt: _c, updatedAt: _u, publishedNotifiedAt: _p, ...rest } = a;
    return {
      ...rest,
      dueAt: a.dueAt?.toISOString() ?? null,
      submissionCount: _count.submissions,
      questions: questions.map((q) => ({
        id: q.id,
        kind: q.kind,
        promptEn: q.promptEn,
        promptAr: q.promptAr,
        weight: q.weight,
        explanationEn: q.explanationEn,
        explanationAr: q.explanationAr,
        options: q.options.map((o) => ({ id: o.id, labelEn: o.labelEn, labelAr: o.labelAr, correct: o.correct })),
      })),
    };
  }

  /** The admin list's ↑/↓ buttons: ids of this course's assessments in their new order. */
  async reorder(courseId: string, ids: string[], admin: Actor): Promise<AdminAssessmentRow[]> {
    await this.course(courseId);
    const all = await this.prisma.assessment.findMany({ where: { courseId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], select: { id: true, order: true } });
    const known = new Set(all.map((a) => a.id));
    if (ids.some((id) => !known.has(id))) {
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: 'ids', message: 'Not an assessment of this course' }] });
    }
    // Any left out (e.g. added in another tab meanwhile) keep their relative order, after these.
    const listed = new Set(ids);
    const next = [...ids, ...all.map((a) => a.id).filter((id) => !listed.has(id))];
    const before = new Map(all.map((a) => [a.id, a.order]));
    await this.prisma.$transaction(async (tx) => {
      for (const [order, id] of next.entries()) {
        if (before.get(id) !== order) await tx.assessment.update({ where: { id }, data: { order } });
      }
      await this.audit.log({ actorId: admin.id, action: 'assessment.reordered', entityType: 'Course', entityId: courseId, metadata: { count: next.length } }, tx);
    });
    return this.list(courseId);
  }

  async create(courseId: string, input: AssessmentInput, admin: Actor): Promise<AdminAssessmentDto> {
    await this.course(courseId);
    await this.checkSession(courseId, input.sessionId);
    const published = input.status === 'PUBLISHED';
    const a = await this.prisma.$transaction(
      async (tx) => {
        // New ones go last unless an order is sent.
        const last = input.order === undefined ? await tx.assessment.aggregate({ where: { courseId }, _max: { order: true } }) : null;
        const created = await tx.assessment.create({
          data: {
            ...fields(input),
            titleAr: input.titleAr ?? '',
            instructionsAr: input.instructionsAr ?? '',
            order: input.order ?? Math.min((last?._max.order ?? -1) + 1, 999),
            courseId,
            // Published right away: this request tells the students (once).
            publishedNotifiedAt: published ? new Date() : null,
          },
        });
        if (input.type === 'QUIZ') await this.saveQuestions(tx, created.id, input.questions);
        await this.audit.log({ actorId: admin.id, action: 'assessment.created', entityType: 'Assessment', entityId: created.id, metadata: { courseId, type: input.type, status: input.status } }, tx);
        return created;
      },
      { timeout: QUESTIONS_TX_TIMEOUT_MS },
    );
    if (published) this.announcePublished(a.id);
    return this.get(a.id);
  }

  async update(id: string, input: AssessmentInput, admin: Actor): Promise<AdminAssessmentDto> {
    const current = await this.prisma.assessment.findUnique({ where: { id }, include: { ...questionsInclude, _count: { select: { submissions: true } } } });
    if (!current) throw new NotFoundException('Assessment not found');
    if (current._count.submissions > 0) {
      const locked = this.lockedChange(current, input);
      if (locked) {
        throw new ConflictException({
          code: 'HAS_SUBMISSIONS',
          field: locked,
          message: `Students have submitted work: ${locked} can no longer change (wording can). Create a new assessment instead.`,
        });
      }
    }
    await this.checkSession(current.courseId, input.sessionId);
    const firstPublish = await this.prisma.$transaction(
      async (tx) => {
        await tx.assessment.update({ where: { id }, data: fields(input) });
        if (input.type === 'QUIZ') await this.saveQuestions(tx, id, input.questions);
        else await tx.quizQuestion.deleteMany({ where: { assessmentId: id } });
        await this.audit.log(
          { actorId: admin.id, action: 'assessment.updated', entityType: 'Assessment', entityId: id, metadata: { courseId: current.courseId, status: input.status, statusBefore: current.status } },
          tx,
        );
        // Published for the first time: whichever request sets publishedNotifiedAt tells the
        // students, so two saves at once (or unpublish and publish again) never send twice.
        if (input.status !== 'PUBLISHED' || current.status === 'PUBLISHED') return false;
        const claim = await tx.assessment.updateMany({ where: { id, publishedNotifiedAt: null }, data: { publishedNotifiedAt: new Date() } });
        return claim.count === 1;
      },
      { timeout: QUESTIONS_TX_TIMEOUT_MS },
    );
    if (firstPublish) this.announcePublished(id);
    // Publishing counts its scores as points, unpublishing takes them back, and a new
    // scoring rule (best or last attempt) changes which score counts.
    if (current.status !== input.status || current.scoring !== input.scoring) {
      await this.points.syncAssessmentForAll(id).catch((err: unknown) => this.logger.error(`Points sync failed: ${(err as Error).name}`));
    }
    return this.get(id);
  }

  /**
   * What can't change once students have submitted, because stored scores and reviews
   * depend on it: the type, max points, and the questions' set, kinds, weights and key.
   * Wording (prompts, options, explanations) and everything else stays editable.
   */
  private lockedChange(
    current: { type: string; maxPoints: number; questions: { id: string; kind: string; weight: number; options: { id: string; correct: boolean }[] }[] },
    input: AssessmentInput,
  ): string | null {
    if (current.type !== input.type) return 'the type';
    if (current.maxPoints !== input.maxPoints) return 'the max points';
    if (input.type !== 'QUIZ') return null;
    const sig = (qs: { id?: string; kind: string; weight: number; options: { id?: string; correct: boolean }[] }[]) =>
      JSON.stringify(qs.map((q) => [q.id ?? null, q.kind, q.weight, q.options.map((o) => [o.id ?? null, o.correct])]));
    return sig(current.questions) === sig(input.questions) ? null : 'the questions, weights or answer key';
  }

  /**
   * Replaces the question list, keeping the ids of questions and options that stay, so
   * earlier answers still line up. Scores already given are not recalculated. Arabic
   * wording that isn't sent keeps its stored value ('' for new rows), and rows that
   * didn't change aren't written, so a 200-question quiz saves quickly.
   */
  private async saveQuestions(tx: Prisma.TransactionClient, assessmentId: string, questions: QuizQuestionInput[]): Promise<void> {
    const existing = await tx.quizQuestion.findMany({ where: { assessmentId }, include: { options: true } });
    const byId = new Map(existing.map((q) => [q.id, q]));
    const keep = new Set(questions.map((q) => q.id).filter((id): id is string => Boolean(id && byId.has(id))));
    await tx.quizQuestion.deleteMany({ where: { assessmentId, id: { notIn: [...keep] } } });
    const fresh: { order: number; q: QuizQuestionInput }[] = [];
    for (const [i, q] of questions.entries()) {
      const old = q.id ? byId.get(q.id) : undefined;
      if (!old) {
        fresh.push({ order: i, q });
        continue;
      }
      const data = defined({
        order: i,
        kind: q.kind,
        promptEn: q.promptEn,
        promptAr: q.promptAr,
        weight: q.weight,
        explanationEn: q.explanationEn,
        explanationAr: q.explanationAr,
      });
      if (changed(old, data)) await tx.quizQuestion.update({ where: { id: old.id }, data });
      const oldOptions = new Map(old.options.map((o) => [o.id, o]));
      const keepOptions = q.options.map((o) => o.id).filter((id): id is string => Boolean(id && oldOptions.has(id)));
      if (new Set(keepOptions).size !== old.options.length) await tx.quizOption.deleteMany({ where: { questionId: old.id, id: { notIn: keepOptions } } });
      for (const [j, o] of q.options.entries()) {
        const od = defined({ order: j, labelEn: o.labelEn, labelAr: o.labelAr, correct: o.correct });
        const prev = o.id ? oldOptions.get(o.id) : undefined;
        if (prev) {
          if (changed(prev, od)) await tx.quizOption.update({ where: { id: prev.id }, data: od });
        } else {
          await tx.quizOption.create({ data: { ...od, labelAr: o.labelAr ?? '', questionId: old.id } });
        }
      }
    }
    if (!fresh.length) return;
    // New questions in two statements (questions, then all their options) instead of one per row.
    const created = await tx.quizQuestion.createManyAndReturn({
      data: fresh.map(({ order, q }) => ({
        assessmentId,
        order,
        kind: q.kind,
        promptEn: q.promptEn,
        promptAr: q.promptAr ?? '',
        weight: q.weight,
        explanationEn: q.explanationEn,
        explanationAr: q.explanationAr ?? null,
      })),
      select: { id: true, order: true },
    });
    const idByOrder = new Map(created.map((c) => [c.order, c.id]));
    await tx.quizOption.createMany({
      data: fresh.flatMap(({ order, q }) =>
        q.options.map((o, j) => ({ questionId: idByOrder.get(order)!, order: j, labelEn: o.labelEn, labelAr: o.labelAr ?? '', correct: o.correct })),
      ),
    });
  }

  async remove(id: string, admin: Actor): Promise<void> {
    const a = await this.prisma.assessment.findUnique({ where: { id }, include: { _count: { select: { submissions: true } } } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (a._count.submissions > 0) {
      throw new ConflictException({ code: 'HAS_SUBMISSIONS', message: 'Students have submitted work: unpublish it (set it to Draft) instead' });
    }
    await this.prisma.assessment.delete({ where: { id } });
    await this.audit.log({ actorId: admin.id, action: 'assessment.deleted', entityType: 'Assessment', entityId: id, metadata: { courseId: a.courseId } });
  }

  // ------------------------------------------------------------------ gradebook

  /** Every enrolled student with their counted (or latest) submission. */
  async submissions(id: string, filter: SubmissionFilter): Promise<{ assessment: { id: string; type: string; titleEn: string; titleAr: string; maxPoints: number; dueAt: string | null; submissionKind: string | null }; rows: GradebookRow[] }> {
    const a = await this.prisma.assessment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Assessment not found');
    const [enrolled, subs] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { courseId: a.courseId, user: { deletedAt: null } },
        orderBy: { enrolledAt: 'asc' },
        select: { user: { select: { id: true, email: true, profile: { select: { fullNameEn: true } } } } },
      }),
      this.prisma.submission.findMany({ where: { assessmentId: id }, orderBy: { attempt: 'asc' } }),
    ]);
    const rows: GradebookRow[] = enrolled.map(({ user }) => {
      const mine = subs.filter((s) => s.userId === user.id);
      const submitted = mine.filter((s) => s.submittedAt);
      const pick = countedAttempt(submitted, a.scoring) ?? submitted[submitted.length - 1] ?? null;
      const open = mine.some((s) => !s.submittedAt);
      return {
        userId: user.id,
        name: user.profile?.fullNameEn ?? null,
        email: user.email,
        state: pick?.gradedAt ? 'GRADED' : pick ? 'SUBMITTED' : open ? 'IN_PROGRESS' : 'MISSING',
        submissionId: pick?.id ?? null,
        attempts: submitted.length,
        submittedAt: pick?.submittedAt?.toISOString() ?? null,
        late: pick?.late ?? false,
        score: pick?.score ?? null,
        maxScore: a.maxPoints,
        repoCheck: pick?.repoCheck ?? null,
        url: pick?.url ?? null,
        hasFile: Boolean(pick?.fileKey),
      };
    });
    const keep = (r: GradebookRow) => {
      switch (filter) {
        case 'submitted':
          return r.state === 'SUBMITTED';
        case 'graded':
          return r.state === 'GRADED';
        case 'late':
          return r.late;
        case 'missing':
          return r.state === 'MISSING' || r.state === 'IN_PROGRESS';
        default:
          return true;
      }
    };
    return {
      assessment: { id: a.id, type: a.type, titleEn: a.titleEn, titleAr: a.titleAr, maxPoints: a.maxPoints, dueAt: a.dueAt?.toISOString() ?? null, submissionKind: a.submissionKind },
      rows: rows.filter(keep),
    };
  }

  async submission(id: string): Promise<AdminSubmissionDto> {
    const s = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        assessment: { include: questionsInclude },
        user: { select: { id: true, email: true, profile: { select: { fullNameEn: true } } } },
        gradedBy: { select: { email: true, profile: { select: { fullNameEn: true } } } },
      },
    });
    if (!s) throw new NotFoundException('Submission not found');
    const attempts = await this.prisma.submission.findMany({
      where: { assessmentId: s.assessmentId, userId: s.userId },
      orderBy: { attempt: 'asc' },
      select: { id: true, attempt: true, submittedAt: true, score: true, late: true },
    });
    return {
      id: s.id,
      assessmentId: s.assessmentId,
      type: s.assessment.type,
      submissionKind: s.assessment.submissionKind,
      student: { id: s.user.id, name: s.user.profile?.fullNameEn ?? null, email: s.user.email },
      attempt: s.attempt,
      attempts: attempts.map((x) => ({ ...x, submittedAt: x.submittedAt?.toISOString() ?? null })),
      startedAt: s.startedAt.toISOString(),
      submittedAt: s.submittedAt?.toISOString() ?? null,
      late: s.late,
      url: s.url,
      fileName: s.fileName,
      hasFile: Boolean(s.fileKey),
      note: s.note,
      attested: s.attested,
      repoCheck: s.repoCheck,
      score: s.score,
      maxScore: s.maxScore,
      gradedAt: s.gradedAt?.toISOString() ?? null,
      gradedBy: s.gradedBy ? (s.gradedBy.profile?.fullNameEn ?? s.gradedBy.email) : null,
      feedback: s.feedback,
      rubricNotes: s.rubricNotes,
      review: s.assessment.type === 'QUIZ' && s.submittedAt ? buildReview(s.assessment, s) : null,
    };
  }

  async fileUrl(id: string, admin: Actor): Promise<{ url: string; expiresIn: number }> {
    const s = await this.prisma.submission.findUnique({ where: { id }, select: { fileKey: true, assessmentId: true } });
    if (!s?.fileKey) throw new NotFoundException('No file');
    await this.audit.log({ actorId: admin.id, action: 'submission.file_viewed', entityType: 'Submission', entityId: id, metadata: { assessmentId: s.assessmentId } });
    return { url: await this.storage.signedUrl(s.fileKey), expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  /** Score + written feedback. Every change is audited; the student is told in-app and by email. */
  async grade(id: string, input: GradeInput, admin: Actor): Promise<AdminSubmissionDto> {
    const s = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        assessment: { include: { course: { select: { slug: true, titleEn: true, titleAr: true } } } },
        user: { select: { id: true, email: true, locale: true, deletedAt: true } },
      },
    });
    if (!s) throw new NotFoundException('Submission not found');
    if (!s.submittedAt) throw new ConflictException({ code: 'NOT_SUBMITTED', message: 'This attempt has not been submitted yet' });
    if (input.submittedAt && new Date(input.submittedAt).getTime() !== s.submittedAt.getTime()) {
      throw new ConflictException({ code: 'RESUBMITTED', message: 'The student resubmitted since you opened this: reload it before grading' });
    }
    if (input.score > s.maxScore) {
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: 'score', message: `At most ${s.maxScore}` }] });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Same version as checked above, even if the student resubmits at this very moment.
      const r = await tx.submission.updateMany({
        where: { id, submittedAt: s.submittedAt },
        data: { score: input.score, feedback: input.feedback, rubricNotes: input.rubricNotes, gradedAt: now, gradedById: admin.id },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'RESUBMITTED', message: 'The student resubmitted since you opened this: reload it before grading' });
      await this.audit.log(
        {
          actorId: admin.id,
          action: s.gradedAt ? 'submission.regraded' : 'submission.graded',
          entityType: 'Submission',
          entityId: id,
          metadata: { assessmentId: s.assessmentId, userId: s.userId, score: input.score, previousScore: s.score, maxScore: s.maxScore },
        },
        tx,
      );
    });
    // Points follow the counted score: a regrade appends the difference.
    await this.points.syncAssessmentSafe(s.assessmentId, s.userId);
    if (!s.user.deletedAt) this.tellStudent(s, input.score);
    return this.submission(id);
  }

  private tellStudent(
    s: { user: { id: string; email: string; locale: 'en' | 'ar' }; maxScore: number; assessmentId: string; assessment: { titleEn: string; titleAr: string; course: { slug: string; titleEn: string; titleAr: string } } },
    score: number,
  ): void {
    const a = s.assessment;
    const path = `/learn/${a.course.slug}/assessments/${s.assessmentId}`;
    void this.notifications
      .create(s.user.id, {
        type: 'assessment.graded',
        titleEn: `Graded: ${a.titleEn}`,
        titleAr: `تم التقييم: ${a.titleAr || a.titleEn}`,
        bodyEn: `You scored ${score}/${s.maxScore}. Open it to read the feedback.`,
        bodyAr: `حصلت على ${score} من ${s.maxScore}. افتحه لقراءة الملاحظات.`,
        link: path,
      })
      .catch((err: unknown) => this.logger.error(`Grade notification failed: ${(err as Error).name}`));
    const ar = s.user.locale === 'ar';
    void this.email.send(
      s.user.email,
      s.user.locale,
      {
        name: 'assessmentGraded',
        courseTitle: ar ? a.course.titleAr : a.course.titleEn,
        title: ar ? a.titleAr || a.titleEn : a.titleEn,
        score,
        maxScore: s.maxScore,
        url: this.email.url(s.user.locale, path),
      },
      { bulk: true },
    );
  }

  /**
   * Tells the course's students about a newly published assessment, after the admin's
   * request has finished (never blocking it): an in-app notification for each enrolled
   * student, and an email on the bulk lane for those who haven't turned this course's
   * reminders off. Called once per assessment (see publishedNotifiedAt). Logs counts only.
   */
  private announcePublished(id: string): void {
    void this.sendPublishedNotices(id).catch((err: unknown) => this.logger.error(`Publish notice failed: ${(err as Error).name}`));
  }

  /** Returns the number of students told in-app (exposed for tests). */
  async sendPublishedNotices(id: string): Promise<number> {
    const a = await this.prisma.assessment.findUnique({
      where: { id },
      select: { id: true, courseId: true, status: true, type: true, titleEn: true, titleAr: true, dueAt: true, course: { select: { slug: true, titleEn: true, titleAr: true, status: true } } },
    });
    // Unpublished again meanwhile, or a course that is over or not running: nobody to tell.
    if (!a || a.status !== 'PUBLISHED' || !['OPEN', 'CLOSED'].includes(a.course.status)) return 0;
    const students = await this.prisma.enrollment.findMany({
      where: { courseId: a.courseId, user: { deletedAt: null, anonymizedAt: null } },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            locale: true,
            profile: { select: { timezone: true } },
            reminderPreferences: { where: { courseId: a.courseId, emailReminders: false }, select: { courseId: true } },
          },
        },
      },
    });
    if (!students.length) return 0;
    const path = `/learn/${a.course.slug}/assessments/${a.id}`;
    const titleAr = a.titleAr || a.titleEn;
    const courseAr = a.course.titleAr || a.course.titleEn;
    const kindEn = { QUIZ: 'quiz', LAB: 'lab', ASSIGNMENT: 'assignment' }[a.type];
    const kindAr = { QUIZ: 'اختبار', LAB: 'تمرين عملي', ASSIGNMENT: 'واجب' }[a.type];
    await this.prisma.notification.createMany({
      data: students.map(({ user }) => ({
        userId: user.id,
        type: 'assessment.published',
        titleEn: `New ${kindEn}: ${a.titleEn}`,
        titleAr: `${kindAr} جديد: ${titleAr}`,
        bodyEn: a.dueAt ? `In ${a.course.titleEn}. Due ${formatDueAt(a.dueAt, 'en', user.profile?.timezone)}.` : `In ${a.course.titleEn}.`,
        bodyAr: a.dueAt ? `في ${courseAr}. موعد التسليم: ${formatDueAt(a.dueAt, 'ar', user.profile?.timezone)}.` : `في ${courseAr}.`,
        link: path,
      })),
    });
    let sent = 0;
    let failed = 0;
    for (const { user } of students) {
      if (user.reminderPreferences.length) continue;
      const ar = user.locale === 'ar';
      const ok = await this.email.send(
        user.email,
        user.locale,
        {
          name: 'assessmentPublished',
          courseTitle: ar ? courseAr : a.course.titleEn,
          title: ar ? titleAr : a.titleEn,
          kind: a.type,
          dueAt: a.dueAt ? formatDueAt(a.dueAt, user.locale, user.profile?.timezone) : null,
          url: this.email.url(user.locale, path),
          unsubscribeUrl: `${this.email.url(user.locale, `/learn/${a.course.slug}`)}#reminders`,
        },
        { bulk: true },
      );
      if (ok) sent++;
      else failed++;
    }
    this.logger.log(`Publish notice: ${students.length} notified in-app, ${sent} email(s) sent, ${failed} failed`);
    return students.length;
  }

  /** Students × published assessments, with totals: one CSV per course for instructors. */
  async gradebookCsv(courseId: string, admin: Actor): Promise<string> {
    await this.course(courseId);
    const enrolled = await this.prisma.enrollment.findMany({
      where: { courseId, user: { deletedAt: null } },
      orderBy: { enrolledAt: 'asc' },
      take: 5001,
      select: { user: { select: { id: true, email: true, profile: { select: { fullNameEn: true } } } } },
    });
    const results = await this.assessments.courseResultsFor(courseId, enrolled.map((e) => e.user.id));
    const columns = await this.prisma.assessment.findMany({
      where: { courseId, status: 'PUBLISHED' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { titleEn: true, maxPoints: true },
    });
    await this.audit.log({ actorId: admin.id, action: 'gradebook.exported', entityType: 'Course', entityId: courseId, metadata: { count: enrolled.length } });
    return toCsv(
      ['Name', 'Email', ...columns.map((c) => `${c.titleEn} (/${c.maxPoints})`), 'Total', 'Possible', 'Percent', 'Certificate assessments passed'],
      capRows(enrolled, ({ user }) => {
        const r = results.get(user.id)!;
        return [
          user.profile?.fullNameEn ?? '',
          user.email,
          ...r.assessments.map((x) => (x.score !== null ? x.score : x.pending ? 'pending' : 'missing')),
          r.total.earned,
          r.total.possible,
          r.total.percent,
          `${r.certificate.passed}/${r.certificate.required}`,
        ];
      }),
    );
  }
}
