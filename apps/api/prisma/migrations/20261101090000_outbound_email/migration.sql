-- Durable email outbox (feedback emails after every session, assessment publish notices).
-- Additive only: a new table and a column with a default, so the previous release keeps
-- working against this schema (it never reads or writes them). Text plus CHECK constraints
-- instead of new enums.
CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "toOverride" TEXT,
    "courseId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "template" JSONB NOT NULL,
    "lane" TEXT NOT NULL DEFAULT 'bulk',
    "category" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboundEmail_status_check" CHECK ("status" IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
    CONSTRAINT "OutboundEmail_lane_check" CHECK ("lane" IN ('transactional', 'bulk')),
    CONSTRAINT "OutboundEmail_recipient_check" CHECK ("userId" IS NOT NULL OR "toOverride" IS NOT NULL)
);

CREATE UNIQUE INDEX "OutboundEmail_dedupeKey_key" ON "OutboundEmail"("dedupeKey");
CREATE INDEX "OutboundEmail_status_notBefore_idx" ON "OutboundEmail"("status", "notBefore");
CREATE INDEX "OutboundEmail_createdAt_idx" ON "OutboundEmail"("createdAt");

ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-course opt-out of the "How was the session?" emails (everyone is asked by default).
ALTER TABLE "ReminderPreference" ADD COLUMN "feedbackEmails" BOOLEAN NOT NULL DEFAULT true;
