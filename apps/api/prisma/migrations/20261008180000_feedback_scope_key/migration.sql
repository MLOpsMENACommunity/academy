-- One feedback row per student per scope (a session, or "course" for end-of-course feedback).
ALTER TABLE "SessionFeedback" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'course';

-- Backfill existing rows before the unique index is created.
UPDATE "SessionFeedback" SET "scopeKey" = COALESCE("sessionId", 'course');

-- Earlier code could store duplicate end-of-course feedback; keep the newest.
DELETE FROM "SessionFeedback" a
USING "SessionFeedback" b
WHERE a."userId" = b."userId" AND a."courseId" = b."courseId" AND a."scopeKey" = b."scopeKey"
  AND (a."updatedAt" < b."updatedAt" OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id"));

CREATE UNIQUE INDEX "SessionFeedback_userId_courseId_scopeKey_key" ON "SessionFeedback"("userId", "courseId", "scopeKey");
