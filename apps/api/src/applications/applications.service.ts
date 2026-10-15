import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildAnswersSchema,
  courseAvailability,
  initialStatus,
  pickSourceParams,
  SELF_WITHDRAWABLE_STATUSES,
  type Answers,
  type ApplyInput,
  type MyApplicationDetailDto,
  type MyApplicationDto,
  type QuestionOption,
  type SourceParams,
} from '@academy/shared';
import { Prisma, type Application, type ApplicationStatusHistory, type Course, type Enrollment, type ScreeningQuestion } from '@prisma/client';
import { FunnelService } from '../funnel/funnel.service';
import { PrismaService } from '../prisma/prisma.service';
import { toProfileDto } from '../users/profile.service';
import { ApplicationWorkflow, type Actor } from './workflow.service';

type AppWithCourse = Application & {
  course: Pick<Course, 'slug' | 'titleEn' | 'titleAr' | 'type' | 'price' | 'currency' | 'startDate'>;
  history: ApplicationStatusHistory[];
  enrollment: Pick<Enrollment, 'id'> | null;
};

type QuestionRow = Pick<ScreeningQuestion, 'id' | 'labelEn' | 'labelAr' | 'type' | 'options'>;

const COURSE_SELECT = {
  slug: true,
  titleEn: true,
  titleAr: true,
  type: true,
  price: true,
  currency: true,
  startDate: true,
} as const;

function toMyApplication(a: AppWithCourse): MyApplicationDto {
  return {
    id: a.id,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    rejectionReason: a.rejectionReason,
    enrolled: Boolean(a.enrollment),
    course: { ...a.course, startDate: a.course.startDate?.toISOString() ?? null },
    history: [...a.history]
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, reason: h.reason, createdAt: h.createdAt.toISOString() })),
  };
}

/** The student's view of one application: shared by GET and by the apply response. */
function toMyApplicationDetail(a: AppWithCourse, questions: QuestionRow[]): MyApplicationDetailDto {
  return {
    ...toMyApplication(a),
    answers: a.answers as Answers,
    source: a.source as SourceParams,
    questions: questions.map((q) => ({
      id: q.id,
      labelEn: q.labelEn,
      labelAr: q.labelAr,
      type: q.type,
      options: q.options as QuestionOption[] | null,
    })),
  };
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApplicationWorkflow,
    private readonly funnel: FunnelService,
  ) {}

  /**
   * QA M5: the user and the course are read in parallel, the student's email is
   * queued rather than awaited, and the response is built from rows already in
   * hand instead of being read back (24 sequential database round trips before; about half now).
   */
  async apply(userId: string, input: ApplyInput): Promise<MyApplicationDetailDto> {
    const [user, course] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { profile: { include: { skills: true } } },
      }),
      this.prisma.course.findUnique({
        where: { slug: input.courseSlug },
        include: {
          screeningQuestions: { orderBy: { order: 'asc' } },
          // For the confirmation email's start date.
          sessions: { orderBy: { startsAt: 'asc' }, take: 1, select: { startsAt: true } },
        },
      }),
    ]);
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'Confirm your email address before applying' });
    }
    if (!user.profile?.coreCompletedAt) {
      throw new ForbiddenException({ code: 'PROFILE_INCOMPLETE', message: 'Complete your profile before applying' });
    }

    if (!course || course.status === 'DRAFT' || course.status === 'ARCHIVED') throw new NotFoundException('Course not found');
    if (courseAvailability(course) !== 'OPEN') {
      throw new ConflictException({ code: 'COURSE_CLOSED', message: 'Applications for this course are closed' });
    }

    const questions = course.screeningQuestions.map((q) => ({ ...q, options: q.options as QuestionOption[] | null }));
    const parsed = buildAnswersSchema(questions).safeParse(input.answers);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({ path: `answers.${i.path.join('.')}`, message: i.message })),
      });
    }
    const source = pickSourceParams(input.source ?? {});

    let app: Application;
    let history: ApplicationStatusHistory;
    try {
      ({ app, history } = await this.prisma.$transaction(async (tx) => {
        // Seat fields as of the lock, not as read before it.
        const locked = await this.workflow.lockCourse(tx, course.id);
        const ctx = await this.workflow.context(tx, locked);
        const status = initialStatus(locked.requiresApproval, ctx);
        const data = {
          status,
          answers: parsed.data as Prisma.InputJsonValue,
          // Admins review what the applicant had at application time; filters use the live profile.
          profileSnapshot: toProfileDto(user.profile) as unknown as Prisma.InputJsonValue,
          source: source as Prisma.InputJsonValue,
          ref: source.ref ?? null,
        };
        // Applying again after withdrawing reopens the same application (one per course and
        // student); its history keeps the withdrawal. Read under the course lock.
        const previous = await tx.application.findUnique({
          where: { userId_courseId: { userId, courseId: course.id } },
          select: { id: true, status: true },
        });
        if (previous && previous.status !== 'WITHDRAWN') {
          throw new ConflictException({ code: 'ALREADY_APPLIED', message: 'You have already applied to this course' });
        }
        const saved = previous
          ? await tx.application.update({ where: { id: previous.id }, data: { ...data, rejectionReason: null, createdAt: new Date() } })
          : await tx.application.create({ data: { userId, courseId: course.id, ...data } });
        const h = await this.workflow.recordChange(tx, saved, previous?.status ?? null, status, { id: userId, role: user.role });
        return { app: saved, history: h };
      }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'ALREADY_APPLIED', message: 'You have already applied to this course' });
      }
      throw err;
    }

    // Instant enrolment (or a seat taken): the course pages show the new numbers within seconds.
    this.workflow.publicCountsChanged(history.fromStatus, app.status);
    // Independent side effects, side by side; neither throws, and the email is only queued.
    await Promise.all([
      this.funnel.record({ id: course.id }, 'APPLICATION_SUBMITTED', { userId }),
      this.workflow.afterChange(app, null, null, { user, course }),
    ]);

    // Built from the rows in hand (same mapping as GET), rather than reading the application back.
    const { slug, titleEn, titleAr, type, price, currency, startDate } = course;
    // A reopened application keeps its earlier history.
    const earlier = history.fromStatus
      ? await this.prisma.applicationStatusHistory.findMany({ where: { applicationId: app.id, id: { not: history.id } } })
      : [];
    return toMyApplicationDetail(
      {
        ...app,
        course: { slug, titleEn, titleAr, type, price, currency, startDate },
        history: [...earlier, history],
        // recordChange creates the enrolment in the same transaction when the status is ENROLLED.
        enrollment: app.status === 'ENROLLED' ? { id: app.id } : null,
      },
      course.screeningQuestions,
    );
  }

  /**
   * The student withdraws: the seat goes back to the course (and to the waitlist). Not while a
   * payment is under review (the team settles it, refund included) and never once enrolled.
   */
  async withdraw(user: Actor, id: string): Promise<MyApplicationDetailDto> {
    const app = await this.prisma.application.findFirst({ where: { id, userId: user.id }, select: { id: true, status: true } });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status === 'PAYMENT_SUBMITTED') {
      throw new ConflictException({ code: 'PAYMENT_UNDER_REVIEW', message: 'Your payment is being verified: contact the team to withdraw' });
    }
    if (!SELF_WITHDRAWABLE_STATUSES.includes(app.status)) {
      throw new ConflictException({ code: 'NOT_WITHDRAWABLE', message: "This application can't be withdrawn" });
    }
    await this.workflow.transition(app.id, 'WITHDRAW', user);
    return this.getMine(user.id, app.id);
  }

  async listMine(userId: string): Promise<MyApplicationDto[]> {
    const apps = await this.prisma.application.findMany({
      where: { userId },
      include: { course: { select: COURSE_SELECT }, history: true, enrollment: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return apps.map(toMyApplication);
  }

  async getMine(userId: string, id: string): Promise<MyApplicationDetailDto> {
    const a = await this.prisma.application.findFirst({
      where: { id, userId },
      include: {
        course: { select: { ...COURSE_SELECT, screeningQuestions: { orderBy: { order: 'asc' } } } },
        history: true,
        enrollment: { select: { id: true } },
      },
    });
    if (!a) throw new NotFoundException('Application not found');
    const { screeningQuestions, ...course } = a.course;
    return toMyApplicationDetail({ ...a, course }, screeningQuestions);
  }
}
