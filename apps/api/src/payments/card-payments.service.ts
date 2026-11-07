import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CARD_PAYMENT_NEEDS_REFUND, type CardCheckoutDto, type Locale, type Role } from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { ApplicationWorkflow } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { isSettledPayment, PaymobClient, type PaymobTransaction } from './paymob';

const PAYABLE = ['AWAITING_PAYMENT', 'PAYMENT_REJECTED'] as const;

export type WebhookOutcome = 'enrolled' | 'ignored' | 'duplicate' | 'unknown_checkout' | 'needs_refund';

/**
 * Card payments through Paymob. The student is sent to Paymob's hosted page; the signed
 * webhook (never the browser redirect) is what enrols them, with CARD_PAID. A payment that
 * can't enrol (wrong amount, or the application moved on meanwhile) is recorded as REJECTED
 * with a refund note and the finance team is told.
 */
@Injectable()
export class CardPaymentsService {
  private readonly logger = new Logger(CardPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApplicationWorkflow,
    private readonly paymob: PaymobClient,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get enabled(): boolean {
    return this.paymob.enabled;
  }

  async startCheckout(user: { id: string; role: Role }, applicationId: string, locale: Locale): Promise<CardCheckoutDto> {
    if (!this.paymob.enabled) {
      throw new ServiceUnavailableException({
        code: 'CARD_NOT_CONFIGURED',
        message: 'Card payments are not available',
      });
    }
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, userId: user.id },
      include: {
        course: {
          select: {
            type: true,
            price: true,
            currency: true,
            titleEn: true,
            recordingsPlatform: true,
          },
        },
        user: {
          select: {
            email: true,
            profile: { select: { fullNameEn: true, phone: true, googleEmail: true } },
          },
        },
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.course.type !== 'PAID') throw new BadRequestException({ code: 'NOT_PAID', message: 'This course is free' });
    if (!(PAYABLE as readonly string[]).includes(app.status)) {
      throw new ConflictException({
        code: 'NOT_AWAITING_PAYMENT',
        message: 'This application is not awaiting payment',
      });
    }
    // Same rule as the manual methods: recordings are shared with this account (Risk 1).
    if (app.course.recordingsPlatform === 'GOOGLE_DRIVE' && !app.user.profile?.googleEmail) {
      throw new BadRequestException({
        code: 'GOOGLE_EMAIL_REQUIRED',
        message: 'Add your Google account email to your profile first',
      });
    }

    const checkout = await this.prisma.cardCheckout.create({
      data: { applicationId, amount: app.course.price, currency: app.course.currency },
    });
    const [firstName = '', ...rest] = (app.user.profile?.fullNameEn ?? '').trim().split(/\s+/);
    const web = this.env.WEB_URL.replace(/\/+$/, '');
    const created = await this.paymob.createCheckout({
      reference: checkout.id,
      amountCents: app.course.price * 100,
      currency: app.course.currency,
      itemName: app.course.titleEn,
      billing: {
        firstName,
        lastName: rest.join(' '),
        email: app.user.email,
        phone: app.user.profile?.phone ?? '',
      },
      notificationUrl: `${web}/api/payments/paymob/webhook`,
      // Only brings the student back; the page waits for the webhook to enrol them.
      redirectionUrl: `${web}/${locale}/dashboard/applications/${applicationId}?card=return`,
    });
    await this.prisma.cardCheckout.update({
      where: { id: checkout.id },
      data: { intentionId: created.intentionId || null, providerOrderId: created.orderId },
    });
    return { url: created.url };
  }

  /** Called with a transaction whose HMAC was already verified. Idempotent. */
  async handleTransaction(t: PaymobTransaction): Promise<WebhookOutcome> {
    if (!isSettledPayment(t)) return 'ignored'; // declined, pending, refunds and voids: nothing to do
    const transactionId = String(t.id);
    const orderId = String(t.order.id);
    const ref = t.order.merchant_order_id ?? '';
    const checkout = await this.prisma.cardCheckout.findFirst({
      where: { OR: [...(ref ? [{ id: ref }] : []), { providerOrderId: orderId }] },
      include: { application: { select: { id: true, userId: true, status: true } } },
    });
    if (!checkout) {
      // Signed by Paymob but not ours to match (another integration on the same account).
      this.logger.warn(`Paymob transaction ${transactionId} matches no card checkout`);
      return 'unknown_checkout';
    }
    if (checkout.completedAt) return 'duplicate';

    const amountOk = t.amount_cents === checkout.amount * 100 && t.currency === checkout.currency;
    const payment = (tx: Prisma.TransactionClient, approved: boolean) =>
      tx.payment.create({
        data: {
          applicationId: checkout.applicationId,
          method: 'CARD',
          amount: Math.round(t.amount_cents / 100),
          currency: t.currency,
          transactionRef: transactionId,
          transactionRefKey: transactionId.toUpperCase().replace(/[^A-Z0-9]/g, ''),
          senderName: '',
          senderPhone: t.source_data?.pan ? `•••• ${t.source_data.pan}` : '',
          paidAt: new Date(t.created_at || Date.now()),
          status: approved ? 'APPROVED' : 'REJECTED',
          verifiedInHistory: approved,
          rejectionReason: approved ? null : CARD_PAYMENT_NEEDS_REFUND,
          reviewedAt: new Date(),
        },
      });
    const complete = (tx: Prisma.TransactionClient, paymentId: string) =>
      // Claims the checkout: a concurrent duplicate webhook fails here and rolls back.
      tx.cardCheckout
        .updateMany({
          where: { id: checkout.id, completedAt: null },
          data: { completedAt: new Date(), transactionId, paymentId },
        })
        .then((r) => {
          if (r.count === 0)
            throw new ConflictException({
              code: 'ALREADY_COMPLETED',
              message: 'Checkout already completed',
            });
        });

    if (amountOk && (PAYABLE as readonly string[]).includes(checkout.application.status)) {
      try {
        await this.workflow.transition(checkout.applicationId, 'CARD_PAID', null, {
          within: async (tx) => {
            const p = await payment(tx, true);
            await complete(tx, p.id);
            await this.audit.log(
              {
                actorId: null,
                action: 'payment.card_paid',
                entityType: 'Payment',
                entityId: p.id,
                metadata: { applicationId: checkout.applicationId, transactionId },
              },
              tx,
            );
          },
        });
        return 'enrolled';
      } catch (err) {
        if (err instanceof ConflictException && (err.getResponse() as { code?: string }).code === 'ALREADY_COMPLETED') return 'duplicate';
        // The status changed under us (INVALID_TRANSITION): fall through to the refund path.
        if (!(err instanceof ConflictException)) throw err;
      }
    }

    // The money arrived but can't enrol: keep the record, flag it for a refund.
    let paymentId: string;
    try {
      paymentId = await this.prisma.$transaction(async (tx) => {
        const p = await payment(tx, false);
        await complete(tx, p.id);
        await this.audit.log(
          {
            actorId: null,
            action: 'payment.card_needs_refund',
            entityType: 'Payment',
            entityId: p.id,
            metadata: { applicationId: checkout.applicationId, transactionId, amountOk },
          },
          tx,
        );
        return p.id;
      });
    } catch (err) {
      if (err instanceof ConflictException) return 'duplicate';
      throw err;
    }
    await this.notifications
      .notifyAdmins(
        {
          type: 'admin.card_payment_refund',
          titleEn: 'A card payment needs a refund',
          titleAr: 'دفعة بالبطاقة تحتاج إلى استرداد',
          bodyEn:
            'A card payment arrived that could not enrol the student (the amount differed, or the application was no longer awaiting payment). Check it and refund it in the Paymob dashboard.',
          bodyAr:
            'وصلت دفعة بالبطاقة لم يمكن تسجيل الطالب بها (اختلف المبلغ، أو لم يعد الطلب في انتظار الدفع). راجعها واستردّها من لوحة Paymob.',
          link: `/admin/payments/${paymentId}`,
        },
        ['FINANCE'],
      )
      .catch(() => this.logger.error('Telling the finance team about a card refund failed'));
    return 'needs_refund';
  }
}
