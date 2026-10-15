import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Locale } from '@academy/shared';
import { Prisma } from '@prisma/client';
import { EmailService, type SendResult } from '../email/email.service';
import type { EmailTemplate } from '../email/templates/catalog';
import { PrismaService } from '../prisma/prisma.service';
import { EmailPreferenceLinks, type OptOutKind } from './email-links';

/** Rows claimed per round trip. */
const BATCH = 50;
/** A claim this old belongs to a run that died (crash, deploy, container sleep). */
const LEASE_MINUTES = 5;
/** Sends per row, counting the first. */
export const MAX_ATTEMPTS = 3;
/** Wait before the 2nd and 3rd attempts. The next drain is the next tick or enqueue. */
const BACKOFF_MS = [5 * 60_000, 30 * 60_000];
/** Retention (by createdAt): sent and skipped rows after 7 days, failed ones after 30. */
export const KEEP_DONE_DAYS = 7;
export const KEEP_FAILED_DAYS = 30;

/** Each category's per-course opt-out (ReminderPreference), re-checked just before sending. */
const OPT_OUT: Record<string, OptOutKind> = { feedback: 'feedback', 'assessment-published': 'reminders' };

/** The columns the claim returns (raw SQL, so typed by hand). */
interface ClaimedRow {
  id: string;
  userId: string | null;
  toOverride: string | null;
  courseId: string | null;
  locale: string;
  template: unknown;
  lane: string;
  category: string;
  attempts: number;
}

/** Postgres "now" as UTC wall time: Prisma stores DateTime as UTC in timestamp columns. */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const LEASE = Prisma.raw(`interval '${LEASE_MINUTES} minutes'`);

/**
 * Sends the outbox. Runs single-flight (concurrent calls share one run): after an enqueue,
 * on startup and on every jobs tick (after the tick has answered).
 *
 * Each round claims up to 50 due rows in one statement (UPDATE … FOR UPDATE SKIP LOCKED …
 * RETURNING, no interactive transaction, so it works through a pooler): they become SENDING
 * with a 5-minute lease and one more attempt. A run that dies mid-batch leaves its rows
 * SENDING; once the lease expires they go back to PENDING and are sent again with the same
 * provider idempotency key (the row id), so the provider never delivers one twice.
 */
@Injectable()
export class OutboxProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly links: EmailPreferenceLinks,
  ) {}

  onApplicationBootstrap(): void {
    // Resume anything a restart interrupted, without delaying startup.
    void this.process().catch(() => undefined);
  }

  /** Rows waiting to be sent (due or not), for the tick's report. */
  pending(): Promise<number> {
    return this.prisma.outboundEmail.count({ where: { status: { in: ['PENDING', 'SENDING'] } } });
  }

  /** Sends every due row; concurrent calls share one run. Resolves with the number sent. */
  process(): Promise<number> {
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<number> {
    let sent = 0;
    let failed = 0;
    try {
      await this.recoverExpiredLeases();
      for (;;) {
        const batch = await this.claim();
        if (!batch.length) break;
        for (const [i, row] of batch.entries()) {
          const outcome = await this.handle(row);
          if (outcome === 'sent') sent++;
          else if (outcome === 'failed') failed++;
          else if (outcome === 'quota') {
            // Every later send would hit the same limit: hand the rest of the batch back too.
            await this.release(batch.slice(i + 1).map((r) => r.id), nextUtcDay());
            this.logger.warn('Email quota reached: the outbox resumes tomorrow');
            return sent;
          }
        }
      }
    } catch (err) {
      // Claimed rows stay SENDING and are recovered when their lease expires.
      this.logger.error(`Outbox run failed: ${(err as Error).name}`);
    } finally {
      if (sent || failed) this.logger.log(`Outbox: ${sent} sent, ${failed} failed for good`);
    }
    return sent;
  }

  /** Rows a dead run left SENDING: back to PENDING, or FAILED once out of attempts. */
  private recoverExpiredLeases(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "OutboundEmail"
      SET "status" = CASE WHEN "attempts" >= ${MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END,
          "leaseUntil" = NULL,
          "lastError" = COALESCE("lastError", 'lease_expired')
      WHERE "status" = 'SENDING' AND "leaseUntil" < ${NOW}`;
  }

  private claim(): Promise<ClaimedRow[]> {
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "OutboundEmail"
      SET "status" = 'SENDING', "leaseUntil" = ${NOW} + ${LEASE}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "OutboundEmail"
        WHERE "status" = 'PENDING' AND "notBefore" <= ${NOW}
        ORDER BY CASE "lane" WHEN 'transactional' THEN 0 ELSE 1 END, "createdAt", "id"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "userId", "toOverride", "courseId", "locale", "template", "lane", "category", "attempts"`;
  }

  /** Puts claimed rows back without using up an attempt (quota reached before they were tried). */
  private async release(ids: string[], notBefore: Date): Promise<void> {
    if (!ids.length) return;
    await this.prisma.outboundEmail.updateMany({
      where: { id: { in: ids }, status: 'SENDING' },
      data: { status: 'PENDING', leaseUntil: null, notBefore, attempts: { decrement: 1 } },
    });
  }

  /** Only a row this run still holds is updated (a lease can't expire mid-send in practice). */
  private finish(id: string, data: Prisma.OutboundEmailUpdateManyMutationInput): Promise<unknown> {
    return this.prisma.outboundEmail.updateMany({ where: { id, status: 'SENDING' }, data: { leaseUntil: null, ...data } });
  }

  private async handle(row: ClaimedRow): Promise<'sent' | 'failed' | 'retry' | 'skipped' | 'quota'> {
    const recipient = await this.recipient(row);
    if ('skip' in recipient) {
      await this.finish(row.id, { status: 'SKIPPED', lastError: recipient.skip });
      return 'skipped';
    }
    const kind = OPT_OUT[row.category];
    const headers = row.lane === 'bulk' && kind && row.userId && row.courseId ? this.links.headers(kind, row.userId, row.courseId) : undefined;
    let result: SendResult;
    try {
      result = await this.email.deliver(recipient.to, (row.locale === 'ar' ? 'ar' : 'en') as Locale, row.template as EmailTemplate, {
        bulk: row.lane !== 'transactional',
        idempotencyKey: `outbox/${row.id}`,
        headers,
      });
    } catch (err) {
      result = { ok: false, kind: 'retryable', code: (err as Error).name };
    }
    if (result.ok) {
      await this.finish(row.id, { status: 'SENT', sentAt: new Date(), lastError: null });
      return 'sent';
    }
    if (result.kind === 'quota') {
      // Not this email's fault: back to PENDING for tomorrow, without using up an attempt.
      await this.finish(row.id, { status: 'PENDING', notBefore: nextUtcDay(), attempts: { decrement: 1 }, lastError: result.code });
      return 'quota';
    }
    if (result.kind === 'permanent' || row.attempts >= MAX_ATTEMPTS) {
      await this.finish(row.id, { status: 'FAILED', lastError: result.code });
      return 'failed';
    }
    const wait = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]!;
    await this.finish(row.id, { status: 'PENDING', lastError: result.code, notBefore: new Date(Date.now() + wait) });
    return 'retry';
  }

  /** The address, looked up now (never stored), or why this email must not go out any more. */
  private async recipient(row: ClaimedRow): Promise<{ to: string } | { skip: string }> {
    if (!row.userId) return row.toOverride ? { to: row.toOverride } : { skip: 'no_recipient' };
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: {
        email: true,
        deletedAt: true,
        anonymizedAt: true,
        reminderPreferences: row.courseId ? { where: { courseId: row.courseId }, select: { emailReminders: true, feedbackEmails: true } } : false,
      },
    });
    if (!user || user.deletedAt || user.anonymizedAt) return { skip: 'account_deleted' };
    const pref = (user.reminderPreferences as { emailReminders: boolean; feedbackEmails: boolean }[] | undefined)?.[0];
    const kind = OPT_OUT[row.category];
    if (pref && kind === 'feedback' && !pref.feedbackEmails) return { skip: 'opted_out' };
    if (pref && kind === 'reminders' && !pref.emailReminders) return { skip: 'opted_out' };
    return { to: row.toOverride ?? user.email };
  }

  /** Deletes old finished rows (see KEEP_*_DAYS). Returns how many. */
  async purge(now = new Date()): Promise<number> {
    const day = 86_400_000;
    const [done, failed] = await Promise.all([
      this.prisma.outboundEmail.deleteMany({ where: { status: { in: ['SENT', 'SKIPPED'] }, createdAt: { lt: new Date(now.getTime() - KEEP_DONE_DAYS * day) } } }),
      this.prisma.outboundEmail.deleteMany({ where: { status: 'FAILED', createdAt: { lt: new Date(now.getTime() - KEEP_FAILED_DAYS * day) } } }),
    ]);
    return done.count + failed.count;
  }
}

/** Five minutes past the next UTC midnight, when a provider's daily quota has reset. */
export function nextUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
}
