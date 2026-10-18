import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  answersRevealed,
  assessmentResult,
  attemptEnd,
  attemptsLeft,
  certificateTag,
  countedAttempt,
  githubRepoUrl,
  gradeQuiz,
  hasPassed,
  isDriveUrl,
  isLate,
  parseGithubRepoUrl,
  percentOf,
  QUIZ_GRACE_SECONDS,
  quizClosedReason,
  seededShuffle,
  summarizeResults,
  workClosedReason,
  type AssessmentDetailDto,
  type AssessmentState,
  type AssessmentSummaryDto,
  type ClosedReason,
  type CourseResults,
  type MySubmissionDto,
  type QuizAnswers,
  type QuizAttemptDto,
  type QuizQuestionDto,
  type QuizResultDto,
  type QuizReviewDto,
  type WorkSubmissionInput,
} from '@academy/shared';
import { Prisma, type Assessment, type Course, type QuizOption, type QuizQuestion, type Submission } from '@prisma/client';
import type { AuthUser } from '../common/decorators';
import { courseKey, SignedInCache } from '../common/signed-in-cache';
import { PrismaService } from '../prisma/prisma.service';
import { detectFileType, MAX_UPLOAD_BYTES } from '../storage/file-type';
import { SIGNED_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import { PointsService } from '../points/points.service';
import { CourseAccessService } from '../course-access/course-access.service';
import { GithubRepoChecker } from './github-repo-check';

type QuestionWithOptions = QuizQuestion & { options: QuizOption[] };
type FullAssessment = Assessment & { questions: QuestionWithOptions[] };

const questionsInclude = { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } as const;

/** The attempt ends here: its time limit, or a due date that takes no late work (null = open). */
function deadlineOf(a: Pick<Assessment, 'timeLimitMin' | 'dueAt' | 'allowLate'>, s: Pick<Submission, 'startedAt'>): Date | null {
  return attemptEnd(a, s.startedAt);
}

function closed(code: ClosedReason): ConflictException {
  const messages: Record<ClosedReason, string> = {
    NOT_PUBLISHED: 'This assessment is not available',
    PAST_DUE: 'The due date has passed',
    NO_ATTEMPTS: 'You have used all your attempts',
    ANSWERS_REVEALED: 'The answers are out: no more attempts',
    GRADED: 'Your work has been graded',
  };
  return new ConflictException({ code: 'ASSESSMENT_CLOSED', reason: code, message: messages[code] });
}

/** A quiz question as students see it: no correct flags, no explanations. */
export function toQuestionDto(q: QuestionWithOptions, shuffleSeed: string | null): QuizQuestionDto {
  const options = q.options.map((o) => ({ id: o.id, labelEn: o.labelEn, labelAr: o.labelAr }));
  return {
    id: q.id,
    kind: q.kind,
    promptEn: q.promptEn,
    promptAr: q.promptAr,
    weight: q.weight,
    // True/false keeps its order; other options shuffle per attempt when the quiz shuffles.
    options: shuffleSeed && q.kind !== 'TRUE_FALSE' ? seededShuffle(options, `${shuffleSeed}:${q.id}`) : options,
  };
}

/** The answer key for one submitted attempt (only once the reveal rule allows it, or for admins). */
export function buildReview(a: FullAssessment, s: Pick<Submission, 'attempt' | 'answers'>): QuizReviewDto {
  const answers = (s.answers ?? {}) as QuizAnswers;
  const grade = gradeQuiz(a.questions, answers, a.maxPoints);
  return {
    attempt: s.attempt,
    questions: a.questions.map((q) => {
      const chosen = new Set(answers[q.id] ?? []);
      return {
        ...toQuestionDto(q, null),
        explanationEn: q.explanationEn,
        explanationAr: q.explanationAr,
        correct: grade.correct[q.id] ?? false,
        options: q.options.map((o) => ({ id: o.id, labelEn: o.labelEn, labelAr: o.labelAr, correct: o.correct, chosen: chosen.has(o.id) })),
      };
    }),
  };
}

/** Keeps only real question and option ids (each once): what gets stored and graded. */
export function sanitizeAnswers(questions: QuestionWithOptions[], raw: QuizAnswers): QuizAnswers {
  const out: QuizAnswers = {};
  for (const q of questions) {
    const valid = new Set(q.options.map((o) => o.id));
    const picked = [...new Set(raw[q.id] ?? [])].filter((id) => valid.has(id));
    if (picked.length) out[q.id] = picked;
  }
  return out;
}

export function toMySubmission(s: Submission): MySubmissionDto {
  return {
    id: s.id,
    attempt: s.attempt,
    startedAt: s.startedAt.toISOString(),
    submittedAt: s.submittedAt?.toISOString() ?? null,
    late: s.late,
    score: s.score,
    maxScore: s.maxScore,
    gradedAt: s.gradedAt?.toISOString() ?? null,
    feedback: s.gradedAt ? s.feedback : null,
    rubricNotes: s.gradedAt ? s.rubricNotes : null,
    url: s.url,
    fileName: s.fileName,
    hasFile: Boolean(s.fileKey),
    note: s.note,
    repoCheck: s.repoCheck,
  };
}

/**
 * Students' side of assessments, plus the shared score rules (courseResults) that
 * certificates and points build on. Every method checks enrolment on the server;
 * students only ever see PUBLISHED assessments and their own submissions, and the
 * answer key only once the assessment's reveal rule allows it.
 */
@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly github: GithubRepoChecker,
    private readonly points: PointsService,
    private readonly courseAccess: CourseAccessService,
    private readonly cache: SignedInCache,
  ) {}

  /**
   * Whoever teaches the course may read (preview) its published assessments: SUPER and
   * ACADEMIC admins, and the speakers assigned to it (CourseAccessService). Other admins only
   * as enrolled students. Writes (starting, submitting) always need an enrolment.
   */
  private async access(user: AuthUser, slug: string, mode: 'read' | 'write' = 'read'): Promise<Course> {
    // Reads take the course from the signed-in cache (any write empties it); writes ask the database.
    const load = () => this.prisma.course.findUnique({ where: { slug } });
    const course = mode === 'read' ? await this.cache.get(courseKey(slug), load) : await load();
    if (!course) throw new NotFoundException('Course not found');
    // The enrolment first: most readers are students, so the staff check is rarely needed.
    const enrolled = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      select: { id: true },
    });
    if (enrolled || (mode === 'read' && (await this.courseAccess.canTeach(user, course.id)))) return course;
    throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
  }

  private async published(courseId: string, id: string): Promise<FullAssessment> {
    const a = await this.prisma.assessment.findFirst({ where: { id, courseId, status: 'PUBLISHED' }, include: questionsInclude });
    if (!a) throw new NotFoundException('Assessment not found');
    return a;
  }

  /**
   * Closes an attempt whose time ran out (beyond the grace period) without an answer:
   * it is submitted empty and scores 0. Safe to run twice (only open attempts change).
   */
  private async closeExpired(a: Assessment, subs: Submission[], now: Date): Promise<Submission[]> {
    const out: Submission[] = [];
    for (const s of subs) {
      const deadline = deadlineOf(a, s);
      if (!s.submittedAt && deadline && now.getTime() > deadline.getTime() + QUIZ_GRACE_SECONDS * 1000) {
        const data = { submittedAt: deadline, answers: {}, score: 0, gradedAt: now, late: isLate(a.dueAt, deadline) };
        await this.prisma.submission.updateMany({ where: { id: s.id, submittedAt: null }, data });
        out.push({ ...s, ...data });
      } else {
        out.push(s);
      }
    }
    return out;
  }

  private async mine(a: Assessment, userId: string, now: Date): Promise<Submission[]> {
    const subs = await this.prisma.submission.findMany({ where: { assessmentId: a.id, userId }, orderBy: { attempt: 'asc' } });
    return a.type === 'QUIZ' ? this.closeExpired(a, subs, now) : subs;
  }

  private summary(course: Course, a: Assessment & { _count?: { questions: number } }, subs: Submission[], questionCount: number, now: Date): AssessmentSummaryDto & { closed: ClosedReason | null } {
    const submitted = subs.filter((s) => s.submittedAt);
    const inProgress = subs.find((s) => !s.submittedAt) ?? null;
    const counted = countedAttempt(submitted, a.scoring);
    const latest = submitted[submitted.length - 1] ?? null;
    const closedReason =
      a.type === 'QUIZ'
        ? inProgress
          ? null
          : quizClosedReason({ ...a, started: subs.length, submitted: submitted.length, now })
        : workClosedReason({ ...a, hasSubmission: submitted.length > 0, graded: Boolean(latest?.gradedAt), now });
    let state: AssessmentState;
    if (inProgress) state = 'IN_PROGRESS';
    else if (counted) state = 'GRADED';
    else if (submitted.length) state = 'SUBMITTED';
    else state = closedReason === 'PAST_DUE' ? 'MISSED' : 'NOT_STARTED';
    const score = counted?.score ?? null;
    return {
      id: a.id,
      sessionId: a.sessionId,
      type: a.type,
      titleEn: a.titleEn,
      titleAr: a.titleAr,
      order: a.order,
      dueAt: a.dueAt?.toISOString() ?? null,
      allowLate: a.allowLate,
      maxPoints: a.maxPoints,
      passPercent: a.passPercent,
      countsForCertificate: a.countsForCertificate,
      certificateTag: certificateTag(
        { minSessionsPercent: course.certMinSessionsPercent, requireAssessments: course.certRequireAssessments, textEn: course.certRuleEn, textAr: course.certRuleAr },
        course.included as { certificate?: boolean } | null,
        a.countsForCertificate,
      ),
      submissionKind: a.submissionKind,
      attemptsAllowed: a.attemptsAllowed,
      timeLimitMin: a.timeLimitMin,
      questionCount,
      state,
      score,
      percent: percentOf(score, a.maxPoints),
      passed: hasPassed(score, a.maxPoints, a.passPercent),
      late: (counted ?? latest)?.late ?? false,
      attemptsUsed: subs.length,
      due: (state === 'NOT_STARTED' || state === 'IN_PROGRESS') && !closedReason,
      closed: closedReason,
    };
  }

  /** The course's published assessments with this student's status for each. */
  async list(user: AuthUser, slug: string, now = new Date()): Promise<AssessmentSummaryDto[]> {
    const course = await this.access(user, slug);
    const items = await this.prisma.assessment.findMany({
      where: { courseId: course.id, status: 'PUBLISHED' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { questions: true } } },
    });
    const subs = await this.prisma.submission.findMany({
      where: { userId: user.id, assessmentId: { in: items.map((a) => a.id) } },
      orderBy: { attempt: 'asc' },
    });
    const out: AssessmentSummaryDto[] = [];
    for (const a of items) {
      let mine = subs.filter((s) => s.assessmentId === a.id);
      if (a.type === 'QUIZ') mine = await this.closeExpired(a, mine, now);
      const { closed: _closed, ...dto } = this.summary(course, a, mine, a._count.questions, now);
      out.push(dto);
    }
    return out;
  }

  async detail(user: AuthUser, slug: string, id: string, now = new Date()): Promise<AssessmentDetailDto> {
    const course = await this.access(user, slug);
    const a = await this.published(course.id, id);
    const subs = await this.mine(a, user.id, now);
    const { closed: closedReason, ...summary } = this.summary(course, a, subs, a.questions.length, now);
    const submitted = subs.filter((s) => s.submittedAt);
    const open = subs.find((s) => !s.submittedAt) ?? null;
    const revealed =
      a.type === 'QUIZ' &&
      answersRevealed({ ...a, submitted: submitted.length, inProgress: Boolean(open), now });
    return {
      ...summary,
      instructionsEn: a.instructionsEn,
      instructionsAr: a.instructionsAr,
      scoring: a.scoring,
      revealAnswers: a.revealAnswers,
      shuffle: a.shuffle,
      attemptsLeft: a.type === 'QUIZ' ? attemptsLeft(a.attemptsAllowed, subs.length) : null,
      closed: closedReason,
      inProgress: open ? this.attemptDto(a, open) : null,
      submissions: subs.filter((s) => s.submittedAt).map(toMySubmission).reverse(),
      review: revealed ? buildReview(a, submitted[submitted.length - 1]!) : null,
    };
  }

  private attemptDto(a: FullAssessment, s: Submission): QuizAttemptDto {
    const seed = a.shuffle ? s.id : null;
    const questions = a.questions.map((q) => toQuestionDto(q, seed));
    return {
      submissionId: s.id,
      attempt: s.attempt,
      startedAt: s.startedAt.toISOString(),
      deadline: deadlineOf(a, s)?.toISOString() ?? null,
      serverNow: new Date().toISOString(),
      questions: seed ? seededShuffle(questions, seed) : questions,
    };
  }

  /** Opens a quiz attempt (or returns the one already open). The time limit starts now. */
  async start(user: AuthUser, slug: string, id: string, now = new Date()): Promise<QuizAttemptDto> {
    const course = await this.access(user, slug, 'write');
    const a = await this.published(course.id, id);
    if (a.type !== 'QUIZ') throw new BadRequestException({ code: 'NOT_A_QUIZ', message: 'This assessment is not a quiz' });
    const subs = await this.mine(a, user.id, now);
    const open = subs.find((s) => !s.submittedAt);
    if (open) return this.attemptDto(a, open);
    const reason = quizClosedReason({ ...a, started: subs.length, submitted: subs.length, now });
    if (reason) throw closed(reason);
    const attempt = (subs[subs.length - 1]?.attempt ?? 0) + 1;
    try {
      const s = await this.prisma.submission.create({
        data: { assessmentId: a.id, userId: user.id, attempt, startedAt: now, maxScore: a.maxPoints },
      });
      return this.attemptDto(a, s);
    } catch (err) {
      // A double click raced us to the same attempt number: return the attempt it opened.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const s = await this.prisma.submission.findFirst({ where: { assessmentId: a.id, userId: user.id, submittedAt: null } });
        if (s) return this.attemptDto(a, s);
      }
      throw err;
    }
  }

  /** Grades the open attempt on the server. The key never travels to the browser before this. */
  async submitQuiz(user: AuthUser, slug: string, id: string, raw: QuizAnswers, now = new Date()): Promise<QuizResultDto> {
    const course = await this.access(user, slug, 'write');
    const a = await this.published(course.id, id);
    if (a.type !== 'QUIZ') throw new BadRequestException({ code: 'NOT_A_QUIZ', message: 'This assessment is not a quiz' });
    const open = await this.prisma.submission.findFirst({ where: { assessmentId: a.id, userId: user.id, submittedAt: null } });
    if (!open) throw new ConflictException({ code: 'NO_OPEN_ATTEMPT', message: 'Start the quiz first' });
    const deadline = deadlineOf(a, open);
    if (deadline && now.getTime() > deadline.getTime() + QUIZ_GRACE_SECONDS * 1000) {
      await this.closeExpired(a, [open], now);
      throw new ConflictException({ code: 'TIME_UP', message: 'The time for this attempt has passed' });
    }
    const answers = sanitizeAnswers(a.questions, raw);
    const grade = gradeQuiz(a.questions, answers, a.maxPoints);
    const late = isLate(a.dueAt, now);
    const done = await this.prisma.submission.updateMany({
      where: { id: open.id, submittedAt: null },
      data: { answers, submittedAt: now, late, score: grade.score, maxScore: a.maxPoints, gradedAt: now, gradedById: null },
    });
    if (done.count !== 1) throw new ConflictException({ code: 'ALREADY_SUBMITTED', message: 'This attempt was already submitted' });
    // Points follow the counted score (a better attempt adds the difference).
    await this.points.syncAssessmentSafe(a.id, user.id);
    const submitted = await this.prisma.submission.count({ where: { assessmentId: a.id, userId: user.id, submittedAt: { not: null } } });
    const started = await this.prisma.submission.count({ where: { assessmentId: a.id, userId: user.id } });
    const revealed = answersRevealed({ ...a, submitted, inProgress: false, now });
    return {
      submissionId: open.id,
      attempt: open.attempt,
      score: grade.score,
      maxScore: a.maxPoints,
      percent: percentOf(grade.score, a.maxPoints) ?? 0,
      passed: hasPassed(grade.score, a.maxPoints, a.passPercent),
      late,
      attemptsLeft: attemptsLeft(a.attemptsAllowed, started),
      review: revealed ? buildReview(a, { attempt: open.attempt, answers }) : null,
    };
  }

  private async workTarget(user: AuthUser, slug: string, id: string, now: Date) {
    const course = await this.access(user, slug, 'write');
    const a = await this.published(course.id, id);
    if (a.type === 'QUIZ' || !a.submissionKind) throw new BadRequestException({ code: 'NOT_A_SUBMISSION', message: 'This assessment takes no file or link' });
    const existing = await this.prisma.submission.findFirst({ where: { assessmentId: a.id, userId: user.id }, orderBy: { attempt: 'desc' } });
    const reason = workClosedReason({ ...a, hasSubmission: Boolean(existing?.submittedAt), graded: Boolean(existing?.gradedAt), now });
    if (reason) throw closed(reason);
    return { a, existing };
  }

  /** One row per student for labs and assignments: resubmitting replaces it (until graded). */
  private async saveWork(
    a: Assessment,
    userId: string,
    existing: Submission | null,
    data: { url: string | null; fileKey: string | null; fileName: string | null; note: string | null; attested: boolean; repoCheck: Submission['repoCheck'] },
    now: Date,
  ): Promise<Submission> {
    const fields = { ...data, submittedAt: now, startedAt: now, late: isLate(a.dueAt, now), maxScore: a.maxPoints, fileDeletedAt: null };
    if (existing) {
      // Only the version this request read: a concurrent resubmission (or a grade) makes this one fail,
      // so the file it replaced is always the one deleted.
      const r = await this.prisma.submission.updateMany({ where: { id: existing.id, gradedAt: null, updatedAt: existing.updatedAt }, data: fields });
      if (r.count !== 1) {
        const now = await this.prisma.submission.findUnique({ where: { id: existing.id }, select: { gradedAt: true } });
        if (now?.gradedAt) throw closed('GRADED');
        throw new ConflictException({ code: 'ALREADY_SUBMITTED', message: 'Your work was just submitted: reload the page' });
      }
      return this.prisma.submission.findUniqueOrThrow({ where: { id: existing.id } });
    }
    try {
      return await this.prisma.submission.create({ data: { ...fields, assessmentId: a.id, userId, attempt: 1 } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'ALREADY_SUBMITTED', message: 'Your work was just submitted: reload the page' });
      }
      throw err;
    }
  }

  async submitWork(user: AuthUser, slug: string, id: string, input: WorkSubmissionInput, now = new Date()): Promise<MySubmissionDto> {
    const { a, existing } = await this.workTarget(user, slug, id, now);
    let url = input.url;
    let repoCheck: Submission['repoCheck'] = null;
    switch (a.submissionKind) {
      case 'PDF':
        throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Upload a PDF file' });
      case 'GITHUB_REPO': {
        const repo = parseGithubRepoUrl(url);
        if (!repo) throw new BadRequestException({ code: 'INVALID_GITHUB_URL', message: 'Enter a link like https://github.com/<owner>/<repo>' });
        if (!input.attested) throw new BadRequestException({ code: 'ATTESTATION_REQUIRED', message: 'Confirm that your repository is public' });
        repoCheck = await this.github.check(repo.owner, repo.repo);
        if (repoCheck === 'NOT_PUBLIC') {
          throw new UnprocessableEntityException({ code: 'REPO_NOT_PUBLIC', message: "This repository isn't public (or doesn't exist)" });
        }
        url = githubRepoUrl(repo);
        break;
      }
      case 'DRIVE_LINK':
        if (!isDriveUrl(url)) throw new BadRequestException({ code: 'INVALID_DRIVE_URL', message: 'Enter a drive.google.com or docs.google.com link' });
        if (!input.attested) throw new BadRequestException({ code: 'ATTESTATION_REQUIRED', message: "Confirm the sharing is set to 'Anyone with the link can view'" });
        break;
      case 'LINK':
        break;
    }
    const saved = await this.saveWork(a, user.id, existing, { url, fileKey: null, fileName: null, note: input.note, attested: input.attested, repoCheck }, now);
    if (existing?.fileKey) await this.safeDelete(existing.fileKey);
    return toMySubmission(saved);
  }

  async submitFile(user: AuthUser, slug: string, id: string, file: Express.Multer.File | undefined, note: string | null, now = new Date()): Promise<MySubmissionDto> {
    const { a, existing } = await this.workTarget(user, slug, id, now);
    if (a.submissionKind !== 'PDF') throw new BadRequestException({ code: 'LINK_REQUIRED', message: 'This assessment takes a link' });
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose a PDF file' });
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'The file must be 5 MB or smaller' });
    if (detectFileType(file.buffer) !== 'application/pdf') throw new BadRequestException({ code: 'FILE_TYPE', message: 'The file must be a PDF' });
    const key = await this.storage.put('submissions', file.buffer, 'application/pdf');
    // The original name is shown back to the student and the grader only (never logged).
    const fileName = (file.originalname || 'submission.pdf').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
    let saved: Submission;
    try {
      saved = await this.saveWork(a, user.id, existing, { url: null, fileKey: key, fileName, note: note?.trim().slice(0, 2000) || null, attested: false, repoCheck: null }, now);
    } catch (err) {
      await this.safeDelete(key);
      throw err;
    }
    if (existing?.fileKey) await this.safeDelete(existing.fileKey);
    return toMySubmission(saved);
  }

  /** A 5-minute link to the student's own uploaded file. */
  async myFileUrl(user: AuthUser, slug: string, id: string): Promise<{ url: string; expiresIn: number }> {
    const course = await this.access(user, slug);
    const a = await this.published(course.id, id);
    const s = await this.prisma.submission.findFirst({ where: { assessmentId: a.id, userId: user.id, fileKey: { not: null } } });
    if (!s?.fileKey) throw new NotFoundException('No file');
    return { url: await this.storage.signedUrl(s.fileKey), expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  private async safeDelete(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      this.logger.warn(`Orphaned submission file needs manual deletion: ${key}`);
    }
  }

  // ------------------------------------------------------------------ shared score rules

  /**
   * A student's results in a course, for certificates (PR C) and points (PR D):
   * per published assessment the best, last and counted score (by its BEST/LAST
   * rule), pass/fail against its pass mark, and the course total.
   */
  async courseResults(userId: string, courseId: string): Promise<CourseResults> {
    return (await this.courseResultsFor(courseId, [userId])).get(userId)!;
  }

  /** courseResults for many students at once (the gradebook). */
  async courseResultsFor(courseId: string, userIds: string[]): Promise<Map<string, CourseResults>> {
    const assessments = await this.prisma.assessment.findMany({
      where: { courseId, status: 'PUBLISHED' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const subs = await this.prisma.submission.findMany({
      where: { assessmentId: { in: assessments.map((a) => a.id) }, userId: { in: userIds }, submittedAt: { not: null } },
      select: { assessmentId: true, userId: true, attempt: true, submittedAt: true, score: true, late: true },
    });
    const out = new Map<string, CourseResults>();
    for (const userId of userIds) {
      const mine = subs.filter((s) => s.userId === userId);
      out.set(
        userId,
        summarizeResults(
          userId,
          courseId,
          assessments.map((a) => assessmentResult(a, mine.filter((s) => s.assessmentId === a.id))),
        ),
      );
    }
    return out;
  }

  // ------------------------------------------------------------------ retention and account deletion

  /** Uploaded PDFs follow the same retention as CVs and payment screenshots; grades stay. */
  async purgeOldFiles(retentionDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    let removed = 0;
    let cursor: string | undefined;
    // Oldest first, paging past any file that can't be deleted now (retried on the next run).
    for (let page = 0; page < 10; page++) {
      const due = await this.prisma.submission.findMany({
        where: { fileKey: { not: null }, submittedAt: { lt: cutoff } },
        select: { id: true, fileKey: true },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!due.length) break;
      cursor = due[due.length - 1]!.id;
      removed += await this.purgeFiles(due, now);
    }
    return removed;
  }

  private async purgeFiles(due: { id: string; fileKey: string | null }[], now: Date): Promise<number> {
    let removed = 0;
    for (const s of due) {
      try {
        await this.storage.delete(s.fileKey!);
      } catch {
        continue; // retried next run
      }
      const r = await this.prisma.submission.updateMany({ where: { id: s.id, fileKey: s.fileKey }, data: { fileKey: null, fileDeletedAt: now } });
      removed += r.count;
    }
    return removed;
  }
}
