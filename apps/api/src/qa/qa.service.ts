import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  boardName,
  canEditPost,
  editableUntil,
  hasAdminPermission,
  nextQaStatus,
  qaExcerpt,
  QA_ANSWER_POINTS,
  QA_PAGE_SIZE,
  type AnswerDto,
  type AnswerInput,
  type AskQuestionInput,
  type EditQuestionInput,
  type QaAuthorDto,
  type QaListDto,
  type QaListQuery,
  type QaStatus,
  type QuestionDetailDto,
  type QuestionSummaryDto,
} from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { CourseAccessService } from '../course-access/course-access.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailPreferenceLinks } from '../outbox/email-links';
import { Outbox } from '../outbox/outbox.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

/** Who is looking: the course, and what they may do in its Q&A. */
interface Viewer {
  user: AuthUser;
  course: { id: string; slug: string; titleEn: string; titleAr: string };
  enrolled: boolean;
  /** Course staff with ANSWER_QUESTIONS, or a SUPER/ACADEMIC admin. */
  moderator: boolean;
}

/** What the API shows about one author (built per request, see authors()). */
interface AuthorInfo {
  name: string | null;
  isStaff: boolean;
  roleLabel: string | null;
  roleLabelAr: string | null;
}

const authorSelect = {
  id: true,
  role: true,
  adminPermissions: true,
  deletedAt: true,
  profile: { select: { fullNameEn: true, fullNameAr: true } },
  speakerProfile: { select: { name: true } },
} as const;
type AuthorRow = Prisma.UserGetPayload<{ select: typeof authorSelect }>;

const sessionSelect = { select: { id: true, order: true, titleEn: true, titleAr: true } } as const;

const questionInclude = {
  session: sessionSelect,
  author: { select: authorSelect },
} as const;
type QuestionRow = Prisma.CourseQuestionGetPayload<{ include: typeof questionInclude }>;

function notEnrolled(): ForbiddenException {
  return new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
}
function notModerator(): ForbiddenException {
  return new ForbiddenException({ code: 'COURSE_PERMISSION', message: "Your role in this course doesn't include this", needed: ['ANSWER_QUESTIONS'] });
}
function questionNotFound(): NotFoundException {
  return new NotFoundException({ code: 'QUESTION_NOT_FOUND', message: 'Question not found' });
}
function answerNotFound(): NotFoundException {
  return new NotFoundException({ code: 'ANSWER_NOT_FOUND', message: 'Answer not found' });
}

/**
 * Course Q&A (docs/FEATURES.md, "Course Q&A"). Students enrolled in the course, its staff with
 * "Answer questions" and SUPER/ACADEMIC admins can read, ask and answer; the last two also
 * moderate (pin, close, hide). Hidden posts stay: their author still sees them, marked hidden.
 * Nothing here ever removes a student or their enrolment.
 */
@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly points: PointsService,
    private readonly notifications: NotificationsService,
    private readonly outbox: Outbox,
    private readonly email: EmailService,
    private readonly links: EmailPreferenceLinks,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ access

  private async viewer(user: AuthUser, slug: string): Promise<Viewer> {
    const course = await this.prisma.course.findUnique({ where: { slug }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    if (!course) throw new NotFoundException('Course not found');
    const [enrollment, moderator] = await Promise.all([
      this.prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } }, select: { id: true } }),
      this.access.can(user, course.id, 'ANSWER_QUESTIONS'),
    ]);
    if (!enrollment && !moderator) throw notEnrolled();
    return { user, course, enrolled: Boolean(enrollment), moderator };
  }

  private moderatorOnly(v: Viewer): void {
    if (!v.moderator) throw notModerator();
  }

  /** What this viewer may see: everything for moderators, else visible posts and their own. */
  private visibleQuestions(v: Viewer): Prisma.CourseQuestionWhereInput {
    return v.moderator ? {} : { OR: [{ hiddenAt: null }, { authorId: v.user.id }] };
  }

  private async question(v: Viewer, questionId: string): Promise<QuestionRow> {
    const q = await this.prisma.courseQuestion.findFirst({ where: { id: questionId, courseId: v.course.id, ...this.visibleQuestions(v) }, include: questionInclude });
    if (!q) throw questionNotFound();
    return q;
  }

  private async sessionOf(courseId: string, sessionId: string | null | undefined): Promise<void> {
    if (!sessionId) return;
    const s = await this.prisma.courseSession.findFirst({ where: { id: sessionId, courseId }, select: { id: true } });
    if (!s) throw new BadRequestException({ code: 'SESSION_NOT_FOUND', message: 'That session is not in this course' });
  }

  // ------------------------------------------------------------------ authors

  /**
   * Names and staff labels for these authors in this course. Students: first name + last initial
   * (like the leaderboards). Staff in a publicly shown role: their speaker or full name and the
   * role's name. Anonymous roles and admins outside the staff: no name and no label ("Course team").
   * A deleted account has no name. Never an email.
   */
  private async authors(courseId: string, rows: AuthorRow[]): Promise<Map<string, AuthorInfo>> {
    const ids = [...new Set(rows.map((r) => r.id))];
    const staff = ids.length
      ? await this.prisma.courseStaff.findMany({
          where: { courseId, userId: { in: ids } },
          select: { userId: true, role: { select: { name: true, nameAr: true, visibility: true } } },
        })
      : [];
    const roleOf = new Map(staff.map((s) => [s.userId!, s.role]));
    const out = new Map<string, AuthorInfo>();
    for (const r of rows) {
      if (out.has(r.id)) continue;
      const role = roleOf.get(r.id);
      const admin = r.role === 'ADMIN' && hasAdminPermission(r, ['ACADEMIC']);
      const isStaff = Boolean(role) || admin;
      const full = r.profile?.fullNameEn || r.profile?.fullNameAr || null;
      const shown = role?.visibility === 'SHOWN';
      // Staff in an anonymous role, and admins outside the course staff, stay anonymous: "Course team".
      let name: string | null = null;
      if (!r.deletedAt) name = isStaff ? (shown ? r.speakerProfile?.name || full : null) : full ? boardName(full) : null;
      out.set(r.id, { name, isStaff, roleLabel: shown ? role!.name : null, roleLabelAr: shown ? role!.nameAr || role!.name : null });
    }
    return out;
  }

  private authorDto(info: AuthorInfo | undefined, authorId: string, v: Viewer): QaAuthorDto {
    return { name: info?.name ?? null, isStaff: info?.isStaff ?? false, roleLabel: info?.roleLabel ?? null, roleLabelAr: info?.roleLabelAr ?? null, isYou: authorId === v.user.id };
  }

  private async summaries(v: Viewer, rows: QuestionRow[]): Promise<QuestionSummaryDto[]> {
    const ids = rows.map((r) => r.id);
    const [authors, votes, follows] = await Promise.all([
      this.authors(
        v.course.id,
        rows.map((r) => r.author),
      ),
      ids.length ? this.prisma.questionVote.findMany({ where: { userId: v.user.id, questionId: { in: ids } }, select: { questionId: true } }) : [],
      ids.length ? this.prisma.questionFollow.findMany({ where: { userId: v.user.id, questionId: { in: ids } }, select: { questionId: true } }) : [],
    ]);
    const voted = new Set(votes.map((x) => x.questionId));
    const following = new Set(follows.map((x) => x.questionId));
    return rows.map((q) => ({
      id: q.id,
      title: q.title,
      session: q.session,
      author: this.authorDto(authors.get(q.authorId), q.authorId, v),
      status: q.status as QaStatus,
      pinned: q.pinned,
      hidden: Boolean(q.hiddenAt),
      voteCount: q.voteCount,
      answerCount: q.answerCount,
      voted: voted.has(q.id),
      following: following.has(q.id),
      hasAccepted: Boolean(q.acceptedAnswerId),
      lastActivityAt: q.lastActivityAt.toISOString(),
      createdAt: q.createdAt.toISOString(),
    }));
  }

  // ------------------------------------------------------------------ reads

  async list(user: AuthUser, slug: string, query: QaListQuery): Promise<QaListDto> {
    const v = await this.viewer(user, slug);
    const and: Prisma.CourseQuestionWhereInput[] = [{ courseId: v.course.id }, this.visibleQuestions(v)];
    if (query.filter === 'unanswered') and.push({ answerCount: 0, status: { not: 'CLOSED' } });
    if (query.filter === 'mine') and.push({ authorId: user.id });
    if (query.filter === 'following') and.push({ follows: { some: { userId: user.id } } });
    if (query.sessionId) and.push({ sessionId: query.sessionId });
    if (query.q) and.push({ OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { body: { contains: query.q, mode: 'insensitive' } }] });
    const where: Prisma.CourseQuestionWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      this.prisma.courseQuestion.count({ where }),
      this.prisma.courseQuestion.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { lastActivityAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * QA_PAGE_SIZE,
        take: QA_PAGE_SIZE,
        include: questionInclude,
      }),
    ]);
    return { items: await this.summaries(v, rows), total, page: query.page, pageSize: QA_PAGE_SIZE, canModerate: v.moderator };
  }

  async detail(user: AuthUser, slug: string, questionId: string, now = new Date()): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    return this.detailFor(v, questionId, now);
  }

  private async detailFor(v: Viewer, questionId: string, now = new Date()): Promise<QuestionDetailDto> {
    const q = await this.question(v, questionId);
    const answers = await this.prisma.courseAnswer.findMany({
      where: { questionId: q.id, ...(v.moderator ? {} : { OR: [{ hiddenAt: null }, { authorId: v.user.id }] }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { author: { select: authorSelect } },
    });
    const [summary] = await this.summaries(v, [q]);
    const authors = await this.authors(
      v.course.id,
      answers.map((a) => a.author),
    );
    const mine = (authorId: string, createdAt: Date) => (authorId === v.user.id && canEditPost(createdAt, now) ? editableUntil(createdAt).toISOString() : null);
    const answerDtos: AnswerDto[] = answers
      .map((a) => ({
        id: a.id,
        body: a.body,
        author: this.authorDto(authors.get(a.authorId), a.authorId, v),
        hidden: Boolean(a.hiddenAt),
        accepted: a.id === q.acceptedAnswerId,
        edited: Boolean(a.editedAt),
        editableUntil: mine(a.authorId, a.createdAt),
        createdAt: a.createdAt.toISOString(),
      }))
      .sort((a, b) => Number(b.accepted) - Number(a.accepted));
    return {
      ...summary!,
      body: q.body,
      edited: Boolean(q.editedAt),
      editableUntil: mine(q.authorId, q.createdAt),
      acceptedAnswerId: q.acceptedAnswerId,
      canAccept: q.authorId === v.user.id || v.moderator,
      canModerate: v.moderator,
      answers: answerDtos,
    };
  }

  // ------------------------------------------------------------------ writes

  async ask(user: AuthUser, slug: string, input: AskQuestionInput): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    await this.sessionOf(v.course.id, input.sessionId);
    const q = await this.prisma.$transaction(async (tx) => {
      const created = await tx.courseQuestion.create({
        data: { courseId: v.course.id, sessionId: input.sessionId, authorId: user.id, title: input.title, body: input.body },
        select: { id: true },
      });
      // Asking follows the question: answers reach the asker.
      await tx.questionFollow.create({ data: { questionId: created.id, userId: user.id } });
      return created;
    });
    return this.detailFor(v, q.id);
  }

  async editQuestion(user: AuthUser, slug: string, questionId: string, input: EditQuestionInput, now = new Date()): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    const q = await this.question(v, questionId);
    // Only the author edits the text, and only for a while; moderators hide instead.
    if (q.authorId !== user.id) throw new ForbiddenException({ code: 'NOT_YOUR_POST', message: 'Only its author can edit this' });
    if (!canEditPost(q.createdAt, now)) throw new ConflictException({ code: 'EDIT_WINDOW_OVER', message: 'Posts can be edited for 30 minutes' });
    if (input.sessionId !== undefined) await this.sessionOf(v.course.id, input.sessionId);
    await this.prisma.courseQuestion.update({
      where: { id: q.id },
      data: { title: input.title, body: input.body, editedAt: now, ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}) },
    });
    return this.detailFor(v, q.id, now);
  }

  async answer(user: AuthUser, slug: string, questionId: string, input: AnswerInput): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    const q = await this.question(v, questionId);
    if (q.status === 'CLOSED') throw new ConflictException({ code: 'QUESTION_CLOSED', message: 'This question is closed' });
    // Read before the transaction (which must only use its own connection).
    const answerer = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: authorSelect });
    const byTeam = (await this.authors(v.course.id, [answerer])).get(user.id)?.isStaff ?? false;
    await this.prisma.$transaction(async (tx) => {
      const a = await tx.courseAnswer.create({ data: { questionId: q.id, authorId: user.id, body: input.body }, select: { id: true, createdAt: true } });
      await tx.questionFollow.createMany({ data: [{ questionId: q.id, userId: user.id }], skipDuplicates: true });
      await this.recount(tx, q.id, a.createdAt);
      await this.tellFollowers(tx, v, q, a.id, user.id, byTeam, input.body);
    });
    this.outbox.kick();
    return this.detailFor(v, q.id);
  }

  async editAnswer(user: AuthUser, slug: string, questionId: string, answerId: string, input: AnswerInput, now = new Date()): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    const q = await this.question(v, questionId);
    const a = await this.prisma.courseAnswer.findFirst({ where: { id: answerId, questionId: q.id }, select: { authorId: true, createdAt: true } });
    if (!a || (a.authorId !== user.id && !v.moderator)) throw answerNotFound();
    if (a.authorId !== user.id) throw new ForbiddenException({ code: 'NOT_YOUR_POST', message: 'Only its author can edit this' });
    if (!canEditPost(a.createdAt, now)) throw new ConflictException({ code: 'EDIT_WINDOW_OVER', message: 'Posts can be edited for 30 minutes' });
    await this.prisma.courseAnswer.update({ where: { id: answerId }, data: { body: input.body, editedAt: now } });
    return this.detailFor(v, q.id, now);
  }

  async vote(user: AuthUser, slug: string, questionId: string, on: boolean): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    const q = await this.question(v, questionId);
    if (q.authorId === user.id) throw new ConflictException({ code: 'OWN_QUESTION', message: 'This is your own question' });
    await this.prisma.$transaction(async (tx) => {
      if (on) await tx.questionVote.createMany({ data: [{ questionId: q.id, userId: user.id }], skipDuplicates: true });
      else await tx.questionVote.deleteMany({ where: { questionId: q.id, userId: user.id } });
      const voteCount = await tx.questionVote.count({ where: { questionId: q.id } });
      await tx.courseQuestion.update({ where: { id: q.id }, data: { voteCount } });
    });
    return this.detailFor(v, q.id);
  }

  async follow(user: AuthUser, slug: string, questionId: string, on: boolean): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    const q = await this.question(v, questionId);
    if (on) await this.prisma.questionFollow.createMany({ data: [{ questionId: q.id, userId: user.id }], skipDuplicates: true });
    else await this.prisma.questionFollow.deleteMany({ where: { questionId: q.id, userId: user.id } });
    return this.detailFor(v, q.id);
  }

  /** The asker or a moderator accepts one visible answer (null: none). A student's accepted answer earns points; staff answers never do. */
  async accept(user: AuthUser, slug: string, questionId: string, answerId: string | null): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    const q = await this.question(v, questionId);
    if (q.authorId !== user.id && !v.moderator) throw new ForbiddenException({ code: 'NOT_YOUR_QUESTION', message: 'Only the asker or the course team can accept an answer' });
    if (answerId) {
      const a = await this.prisma.courseAnswer.findFirst({ where: { id: answerId, questionId: q.id, hiddenAt: null }, select: { id: true } });
      if (!a) throw answerNotFound();
    }
    const previous = q.acceptedAnswerId;
    if (previous !== answerId) {
      await this.prisma.courseQuestion.update({ where: { id: q.id }, data: { acceptedAnswerId: answerId } });
      if (previous) await this.syncAnswerPoints(v.course.id, previous, false, q.authorId);
      if (answerId) await this.syncAnswerPoints(v.course.id, answerId, true, q.authorId);
    }
    return this.detailFor(v, q.id);
  }

  // ------------------------------------------------------------------ moderation

  async pin(user: AuthUser, slug: string, questionId: string, pinned: boolean): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    this.moderatorOnly(v);
    const q = await this.question(v, questionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.courseQuestion.update({ where: { id: q.id }, data: { pinned } });
      await this.audit.log({ actorId: user.id, action: pinned ? 'qa.question_pinned' : 'qa.question_unpinned', entityType: 'CourseQuestion', entityId: q.id, metadata: { courseId: v.course.id } }, tx);
    });
    return this.detailFor(v, q.id);
  }

  async close(user: AuthUser, slug: string, questionId: string, closed: boolean): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    this.moderatorOnly(v);
    const q = await this.question(v, questionId);
    await this.prisma.$transaction(async (tx) => {
      const status: QaStatus = closed ? 'CLOSED' : nextQaStatus('OPEN', q.answerCount > 0);
      await tx.courseQuestion.update({ where: { id: q.id }, data: { status } });
      await this.audit.log({ actorId: user.id, action: closed ? 'qa.question_closed' : 'qa.question_reopened', entityType: 'CourseQuestion', entityId: q.id, metadata: { courseId: v.course.id } }, tx);
    });
    return this.detailFor(v, q.id);
  }

  async hideQuestion(user: AuthUser, slug: string, questionId: string, hidden: boolean): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    this.moderatorOnly(v);
    const q = await this.question(v, questionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.courseQuestion.update({ where: { id: q.id }, data: hidden ? { hiddenAt: new Date(), hiddenById: user.id } : { hiddenAt: null, hiddenById: null } });
      await this.audit.log({ actorId: user.id, action: hidden ? 'qa.question_hidden' : 'qa.question_unhidden', entityType: 'CourseQuestion', entityId: q.id, metadata: { courseId: v.course.id } }, tx);
    });
    return this.detailFor(v, q.id);
  }

  /** Hiding an answer keeps it for its author; an accepted one is un-accepted (and its points go back to 0). */
  async hideAnswer(user: AuthUser, slug: string, questionId: string, answerId: string, hidden: boolean): Promise<QuestionDetailDto> {
    const v = await this.viewer(user, slug);
    this.moderatorOnly(v);
    const q = await this.question(v, questionId);
    const a = await this.prisma.courseAnswer.findFirst({ where: { id: answerId, questionId: q.id }, select: { id: true } });
    if (!a) throw answerNotFound();
    const unaccept = hidden && q.acceptedAnswerId === a.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.courseAnswer.update({ where: { id: a.id }, data: hidden ? { hiddenAt: new Date(), hiddenById: user.id } : { hiddenAt: null, hiddenById: null } });
      if (unaccept) await tx.courseQuestion.update({ where: { id: q.id }, data: { acceptedAnswerId: null } });
      await this.recount(tx, q.id);
      await this.audit.log({ actorId: user.id, action: hidden ? 'qa.answer_hidden' : 'qa.answer_unhidden', entityType: 'CourseAnswer', entityId: a.id, metadata: { courseId: v.course.id, questionId: q.id } }, tx);
    });
    if (unaccept) await this.syncAnswerPoints(v.course.id, a.id, false, q.authorId);
    return this.detailFor(v, q.id);
  }

  // ------------------------------------------------------------------ helpers

  /** Visible answers and the status that follows from them (CLOSED stays closed). */
  private async recount(tx: Prisma.TransactionClient, questionId: string, activityAt?: Date): Promise<void> {
    const [q, answerCount] = await Promise.all([
      tx.courseQuestion.findUniqueOrThrow({ where: { id: questionId }, select: { status: true } }),
      tx.courseAnswer.count({ where: { questionId, hiddenAt: null } }),
    ]);
    await tx.courseQuestion.update({
      where: { id: questionId },
      data: { answerCount, status: nextQaStatus(q.status as QaStatus, answerCount > 0), ...(activityAt ? { lastActivityAt: activityAt } : {}) },
    });
  }

  /**
   * QA_ANSWER_POINTS for an accepted answer by a student (not course staff, not an admin, not the
   * asker answering themselves); 0 when it is no longer accepted. Never fails the request.
   */
  private async syncAnswerPoints(courseId: string, answerId: string, accepted: boolean, askerId: string): Promise<void> {
    try {
      const a = await this.prisma.courseAnswer.findUnique({ where: { id: answerId }, select: { authorId: true, author: { select: { role: true, adminPermissions: true } } } });
      if (!a) return;
      let target = 0;
      if (accepted && a.authorId !== askerId) {
        const staff = await this.prisma.courseStaff.count({ where: { courseId, userId: a.authorId } });
        const admin = a.author.role === 'ADMIN' && hasAdminPermission(a.author, ['ACADEMIC']);
        if (!staff && !admin) target = QA_ANSWER_POINTS;
      }
      await this.points.syncQaAnswer(a.authorId, courseId, answerId, target);
    } catch (err) {
      this.logger.error(`Q&A points sync failed: ${(err as Error).name}`);
    }
  }

  /**
   * A new visible answer: an in-app notification and an email (outbox, course reminders opt-out)
   * to everyone following the question but the person who answered. A hidden question's answers
   * only reach its asker (nobody else can see it).
   */
  private async tellFollowers(tx: Prisma.TransactionClient, v: Viewer, q: QuestionRow, answerId: string, answererId: string, byTeam: boolean, body: string): Promise<void> {
    const recipients: Prisma.StringFilter = q.hiddenAt ? { in: [q.authorId].filter((id) => id !== answererId) } : { not: answererId };
    const follows = await tx.questionFollow.findMany({
      where: { questionId: q.id, userId: recipients, user: { deletedAt: null, anonymizedAt: null } },
      select: {
        user: {
          select: { id: true, locale: true, reminderPreferences: { where: { courseId: v.course.id, emailReminders: false }, select: { courseId: true } } },
        },
      },
    });
    if (!follows.length) return;
    const path = `/learn/${v.course.slug}?q=${q.id}#qa`;
    const courseAr = v.course.titleAr || v.course.titleEn;
    const excerpt = qaExcerpt(body, 280);
    await tx.notification.createMany({
      data: follows.map(({ user }) => ({
        userId: user.id,
        type: 'qa.answer',
        titleEn: `New answer: ${q.title}`,
        titleAr: `إجابة جديدة: ${q.title}`,
        bodyEn: `In ${v.course.titleEn}: ${qaExcerpt(body, 120)}`,
        bodyAr: `في ${courseAr}: ${qaExcerpt(body, 120)}`,
        link: path,
      })),
    });
    const emailed = follows.filter(({ user }) => !user.reminderPreferences.length);
    await this.outbox.enqueue(
      emailed.map(({ user }) => {
        const locale = user.locale === 'ar' ? 'ar' : 'en';
        return {
          userId: user.id,
          locale,
          category: 'qa' as const,
          courseId: v.course.id,
          dedupeKey: `qa-answer:${answerId}:${user.id}`,
          template: {
            name: 'qaAnswer' as const,
            courseTitle: locale === 'ar' ? courseAr : v.course.titleEn,
            questionTitle: q.title,
            excerpt,
            byTeam,
            url: this.email.url(locale, path),
            unsubscribeUrl: this.links.pageUrl(locale, 'reminders', user.id, v.course.id),
          },
        };
      }),
      tx,
    );
  }
}
