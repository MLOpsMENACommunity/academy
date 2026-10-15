import { Injectable } from '@nestjs/common';
import type { Locale } from '@academy/shared';
import type { Prisma } from '@prisma/client';
import type { EmailTemplate } from '../email/templates/catalog';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxProcessor } from './outbox.processor';

export type OutboxLane = 'transactional' | 'bulk';

/** Categories with a per-course opt-out the processor checks again at send time. */
export type OutboxCategory = 'feedback' | 'assessment-published';

export interface OutboxMessage {
  userId: string;
  locale: Locale;
  template: EmailTemplate;
  category: OutboxCategory;
  /** Unique per email, e.g. feedback:<sessionId>:<userId>. Enqueuing it again does nothing. */
  dedupeKey: string;
  courseId?: string | null;
  lane?: OutboxLane;
  notBefore?: Date;
  /**
   * Written as already SKIPPED (with this reason) instead of PENDING: the key is still taken,
   * so a later run doesn't enqueue it again, e.g. a student who turned these emails off.
   */
  skip?: string;
}

/**
 * The durable outgoing-email queue (docs/ENGINEERING.md, "Email pipeline"). enqueue() writes
 * rows, in the caller's transaction when one is passed, so an email exists exactly when the
 * change that caused it was committed. Sending happens in OutboxProcessor.
 */
@Injectable()
export class Outbox {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: OutboxProcessor,
  ) {}

  private rows(messages: OutboxMessage[]): Prisma.OutboundEmailCreateManyInput[] {
    return messages.map((m) => ({
      userId: m.userId,
      locale: m.locale,
      template: m.template as unknown as Prisma.InputJsonValue,
      category: m.category,
      dedupeKey: m.dedupeKey,
      courseId: m.courseId ?? null,
      lane: m.lane ?? 'bulk',
      ...(m.notBefore ? { notBefore: m.notBefore } : {}),
      ...(m.skip ? { status: 'SKIPPED', lastError: m.skip } : {}),
    }));
  }

  /**
   * Adds emails; keys already queued are skipped. Returns the keys that were new. With a
   * transaction client, call kick() after the transaction commits; without one, sending
   * starts at once.
   */
  async enqueue(messages: OutboxMessage[], tx?: Prisma.TransactionClient): Promise<Set<string>> {
    if (!messages.length) return new Set();
    const created = await (tx ?? this.prisma).outboundEmail.createManyAndReturn({
      data: this.rows(messages),
      skipDuplicates: true,
      select: { dedupeKey: true },
    });
    if (!tx) this.kick();
    return new Set(created.map((r) => r.dedupeKey));
  }

  /** Starts sending in the background (never blocks or throws). */
  kick(): void {
    void this.processor.process().catch(() => undefined);
  }
}
