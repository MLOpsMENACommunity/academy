import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  computePaymentFlags,
  normalizeTransactionRef,
  paymentsConfigured,
  configuredPaymentMethods,
  publicContact,
  realValue,
  paymentProofSchema,
  type AdminPaymentDto,
  type MyPaymentDto,
  type PaymentInstructionsDto,
  type PaymentStatus,
} from '@academy/shared';
import type { Payment } from '@prisma/client';
import { ApplicationWorkflow, type Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { detectFileType, MAX_UPLOAD_BYTES } from '../storage/file-type';
import { SIGNED_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';

const PAYABLE = ['AWAITING_PAYMENT', 'PAYMENT_REJECTED'] as const;

function toMyPayment(p: Payment): MyPaymentDto {
  return {
    id: p.id,
    method: p.method,
    amount: p.amount,
    currency: p.currency,
    transactionRef: p.transactionRef,
    paidAt: p.paidAt.toISOString(),
    status: p.status,
    rejectionReason: p.rejectionReason,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * Manual InstaPay / Vodafone Cash payments (Risks 2 and 3):
 * - proof needs reference, sender, amount, date and a screenshot (validated by magic bytes);
 * - screenshots go to the private bucket under random keys and are only ever
 *   shown to admins through 5-minute signed URLs, each view audited;
 * - admins see duplicate-reference, duplicate-screenshot and amount-mismatch
 *   flags, and must confirm they checked the real transaction history.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApplicationWorkflow,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private async ownApplication(userId: string, applicationId: string) {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, userId },
      include: { course: { select: { type: true, price: true, currency: true, recordingsPlatform: true } } },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.course.type !== 'PAID') throw new BadRequestException({ code: 'NOT_PAID', message: 'This course is free' });
    return app;
  }

  async instructions(userId: string, applicationId: string): Promise<PaymentInstructionsDto> {
    const app = await this.ownApplication(userId, applicationId);
    const s = await this.settings.get();
    return {
      amount: app.course.price,
      currency: app.course.currency,
      instapayHandle: realValue(s.instapayHandle),
      instapayName: realValue(s.instapayName),
      vodafoneCashNumber: realValue(s.vodafoneCashNumber),
      vodafoneCashName: realValue(s.vodafoneCashName),
      ...publicContact(s),
      methods: configuredPaymentMethods(s),
      configured: paymentsConfigured(s),
    };
  }

  async listMine(userId: string, applicationId: string): Promise<MyPaymentDto[]> {
    await this.ownApplication(userId, applicationId);
    const payments = await this.prisma.payment.findMany({ where: { applicationId }, orderBy: { createdAt: 'desc' } });
    return payments.map(toMyPayment);
  }

  async submit(
    userId: string,
    applicationId: string,
    fields: Record<string, unknown>,
    file: Express.Multer.File | undefined,
  ): Promise<MyPaymentDto> {
    const app = await this.ownApplication(userId, applicationId);
    if (!(PAYABLE as readonly string[]).includes(app.status)) {
      throw new ConflictException({ code: 'NOT_AWAITING_PAYMENT', message: 'This application is not awaiting payment' });
    }
    if (app.course.recordingsPlatform === 'GOOGLE_DRIVE') {
      // Recordings are shared with this account, so it must exist before paying (Risk 1).
      const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { googleEmail: true } });
      if (!profile?.googleEmail) {
        throw new BadRequestException({ code: 'GOOGLE_EMAIL_REQUIRED', message: 'Add your Google account email to your profile first' });
      }
    }
    const s = await this.settings.get();
    if (!paymentsConfigured(s)) {
      throw new ServiceUnavailableException({ code: 'PAYMENTS_NOT_CONFIGURED', message: 'Payment details are not configured yet' });
    }
    const parsed = paymentProofSchema.safeParse(fields);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (!(configuredPaymentMethods(s) as string[]).includes(parsed.data.method)) {
      throw new BadRequestException({ code: 'METHOD_NOT_AVAILABLE', message: 'This payment method is not available. Choose another one.' });
    }
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Upload a screenshot of the payment' });
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'The file must be 5 MB or smaller' });
    }
    const mime = detectFileType(file.buffer);
    if (!mime) throw new BadRequestException({ code: 'FILE_TYPE', message: 'Upload a JPG, PNG or PDF file' });

    const key = await this.storage.put('payments', file.buffer, mime);
    const p = parsed.data;
    let payment: Payment | undefined;
    try {
      await this.workflow.transition(applicationId, 'SUBMIT_PAYMENT', { id: userId, role: 'STUDENT' }, {
        within: async (tx) => {
          payment = await tx.payment.create({
            data: {
              applicationId,
              method: p.method,
              amount: p.amount,
              currency: app.course.currency,
              transactionRef: p.transactionRef,
              transactionRefKey: normalizeTransactionRef(p.transactionRef),
              senderName: p.senderName,
              senderPhone: p.senderPhone,
              paidAt: p.paidAt,
              screenshotKey: key,
              screenshotSha256: sha256(file.buffer),
              screenshotMime: mime,
            },
          });
        },
      });
    } catch (err) {
      // Don't leave an orphaned screenshot behind if the transition failed.
      await this.storage.delete(key).catch(() => {
        // Keys are random (no personal data); logged so it can be removed by hand.
        this.logger.warn(`Orphaned payment screenshot needs manual deletion: ${key}`);
      });
      throw err;
    }
    return toMyPayment(payment!);
  }

  // ------------------------------------------------------------------ admin

  private static readonly ADMIN_INCLUDE = {
    reviewedBy: { select: { email: true } },
    application: {
      include: {
        course: { select: { id: true, slug: true, titleEn: true, titleAr: true, price: true, currency: true } },
        user: { include: { profile: true } },
      },
    },
  } as const;

  /** Payments sharing a reference key or screenshot hash with any of `payments` (one query). */
  private async related(payments: { transactionRefKey: string; screenshotSha256: string | null }[]) {
    const keys = [...new Set(payments.map((p) => p.transactionRefKey).filter(Boolean))];
    const hashes = [...new Set(payments.map((p) => p.screenshotSha256).filter((h): h is string => Boolean(h)))];
    if (!keys.length && !hashes.length) return [];
    return this.prisma.payment.findMany({
      where: { OR: [...(keys.length ? [{ transactionRefKey: { in: keys } }] : []), ...(hashes.length ? [{ screenshotSha256: { in: hashes } }] : [])] },
      include: {
        application: {
          select: { course: { select: { titleEn: true } }, user: { select: { profile: { select: { fullNameEn: true } } } } },
        },
      },
      take: 500,
    });
  }

  private toAdmin(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape of ADMIN_INCLUDE
    p: Payment & { reviewedBy: { email: string } | null; application: any },
    related: Awaited<ReturnType<PaymentsService['related']>>,
  ): AdminPaymentDto {
    // A student's own earlier attempts on the same application are not "duplicates".
    const others = related.filter(
      (o) =>
        o.id !== p.id &&
        o.applicationId !== p.applicationId &&
        ((p.transactionRefKey && o.transactionRefKey === p.transactionRefKey) ||
          (p.screenshotSha256 && o.screenshotSha256 === p.screenshotSha256)),
    );
    const flags = computePaymentFlags(
      { id: p.id, transactionRef: p.transactionRef, screenshotSha256: p.screenshotSha256, amount: p.amount },
      p.application.course.price,
      others,
    );
    const u = p.application.user;
    return {
      ...toMyPayment(p),
      senderName: p.senderName,
      senderPhone: p.senderPhone,
      hasScreenshot: Boolean(p.screenshotKey),
      screenshotDeleted: Boolean(p.screenshotDeletedAt),
      screenshotMime: p.screenshotMime,
      verifiedInHistory: p.verifiedInHistory,
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      reviewedBy: p.reviewedBy?.email ?? null,
      flags,
      duplicates: others.slice(0, 20).map((o) => ({
        id: o.id,
        studentName: o.application.user.profile?.fullNameEn ?? null,
        courseTitle: o.application.course.titleEn,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      })),
      application: { id: p.application.id, status: p.application.status, createdAt: p.application.createdAt.toISOString() },
      course: p.application.course,
      student: {
        id: u.id,
        email: u.email,
        name: u.profile?.fullNameEn ?? null,
        phone: u.profile?.phone ?? null,
        country: u.profile?.country ?? null,
        googleEmail: u.profile?.googleEmail ?? null,
        jobTitle: u.profile?.jobTitle ?? null,
      },
    };
  }

  /** Two queries per page regardless of size (no per-row lookups). */
  async queue(status: PaymentStatus = 'PENDING_REVIEW', page = 1, pageSize = 50): Promise<AdminPaymentDto[]> {
    const payments = await this.prisma.payment.findMany({
      where: { status },
      // Oldest first for review: first in, first verified.
      orderBy: { createdAt: status === 'PENDING_REVIEW' ? 'asc' : 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: PaymentsService.ADMIN_INCLUDE,
    });
    const related = await this.related(payments);
    return payments.map((p) => this.toAdmin(p, related));
  }

  async count(status: PaymentStatus): Promise<number> {
    return this.prisma.payment.count({ where: { status } });
  }

  async adminGet(id: string): Promise<AdminPaymentDto> {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: PaymentsService.ADMIN_INCLUDE });
    if (!p) throw new NotFoundException('Payment not found');
    return this.toAdmin(p, await this.related([p]));
  }

  /** Short-lived link to view the screenshot. Every view is audited (Risk 3). */
  async screenshotUrl(id: string, admin: Actor): Promise<{ url: string; mime: string | null; expiresIn: number }> {
    const p = await this.prisma.payment.findUnique({ where: { id }, select: { screenshotKey: true, screenshotMime: true } });
    if (!p) throw new NotFoundException('Payment not found');
    if (!p.screenshotKey) throw new NotFoundException({ code: 'SCREENSHOT_DELETED', message: 'The screenshot was deleted by the retention policy' });
    await this.audit.log({ actorId: admin.id, action: 'payment.screenshot_viewed', entityType: 'Payment', entityId: id });
    return { url: await this.storage.signedUrl(p.screenshotKey), mime: p.screenshotMime, expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  private async pending(id: string, admin: Actor) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: { application: { select: { userId: true, user: { select: { anonymizedAt: true, deletedAt: true } } } } },
    });
    if (!p) throw new NotFoundException('Payment not found');

    if (p.application.userId === admin.id) {
      throw new ForbiddenException({ code: 'SELF_REVIEW', message: 'Another admin must review your own payment' });
    }
    if (p.status !== 'PENDING_REVIEW') {
      throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'This payment has already been reviewed' });
    }
    return p;
  }

  async approve(id: string, admin: Actor, verifiedInHistory: boolean): Promise<AdminPaymentDto> {
    if (admin.role !== 'ADMIN') throw new ForbiddenException();
    if (!verifiedInHistory) {
      throw new BadRequestException({ code: 'VERIFY_REQUIRED', message: 'Confirm you verified it in the transaction history' });
    }
    const p = await this.pending(id, admin);
    // Deleting an account closes its pending payments, but older ones may still be waiting:
    // approving would enrol a deleted account. Rejecting (closing) it stays possible.
    if (p.application.user.deletedAt) {
      throw new ConflictException({ code: 'ACCOUNT_DELETED', message: 'The student deleted their account: reject this payment to close it (refund it if the money was received)' });
    }
    await this.workflow.transition(p.applicationId, 'APPROVE_PAYMENT', admin, {
      within: async (tx) => {
        const claimed = await tx.payment.updateMany({
          where: { id, status: 'PENDING_REVIEW' },
          data: { status: 'APPROVED', verifiedInHistory: true, reviewedById: admin.id, reviewedAt: new Date() },
        });
        if (claimed.count === 0) throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'Already reviewed' });
        await this.audit.log(
          {
            actorId: admin.id,
            action: 'payment.approved',
            entityType: 'Payment',
            entityId: id,
            metadata: { verifiedInHistory: true, applicationId: p.applicationId },
          },
          tx,
        );
      },
    });
    return this.adminGet(id);
  }

  async reject(id: string, admin: Actor, reason: string): Promise<AdminPaymentDto> {
    if (admin.role !== 'ADMIN') throw new ForbiddenException();
    const p = await this.pending(id, admin);
    // No free text is written back onto an anonymised account.
    const storedReason = p.application.user.anonymizedAt ? null : reason;
    await this.workflow.transition(p.applicationId, 'REJECT_PAYMENT', admin, {
      reason: storedReason,
      within: async (tx) => {
        const claimed = await tx.payment.updateMany({
          where: { id, status: 'PENDING_REVIEW' },
          data: { status: 'REJECTED', rejectionReason: storedReason, reviewedById: admin.id, reviewedAt: new Date() },
        });
        if (claimed.count === 0) throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'Already reviewed' });
        await this.audit.log(
          { actorId: admin.id, action: 'payment.rejected', entityType: 'Payment', entityId: id, metadata: { applicationId: p.applicationId } },
          tx,
        );
      },
    });
    return this.adminGet(id);
  }

  /** Retention (Risk 3): delete old screenshots, keep the payment record. Returns how many were removed. */
  async purgeOldScreenshots(retentionDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const due = await this.prisma.payment.findMany({
      // Never delete evidence an admin hasn't reviewed yet.
      where: { screenshotKey: { not: null }, createdAt: { lt: cutoff }, status: { not: 'PENDING_REVIEW' } },
      select: { id: true, screenshotKey: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    let removed = 0;
    for (const p of due) {
      try {
        await this.storage.delete(p.screenshotKey!);
      } catch {
        continue; // retried on the next run; the key stays referenced
      }
      await this.prisma.payment.update({
        where: { id: p.id },
        data: { screenshotKey: null, screenshotDeletedAt: now },
      });
      removed++;
    }
    return removed;
  }
}
