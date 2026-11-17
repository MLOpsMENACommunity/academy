-- Cohort challenges: a time-boxed task, students' entries (a link and a note), staff review, and a
-- new points reason. Additive only: two new tables and a new enum value, so the previous release
-- keeps working against this schema (it never reads or writes them). Statuses are text with a
-- CHECK constraint (docs/ENGINEERING.md §7), not new enums.
-- AlterEnum
ALTER TYPE "PointsReason" ADD VALUE 'CHALLENGE';

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "courseId" TEXT,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "badgeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeEntry" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "showName" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_slug_key" ON "Challenge"("slug");

-- CreateIndex
CREATE INDEX "Challenge_status_startsAt_idx" ON "Challenge"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Challenge_courseId_idx" ON "Challenge"("courseId");

-- CreateIndex
CREATE INDEX "ChallengeEntry_challengeId_status_idx" ON "ChallengeEntry"("challengeId", "status");

-- CreateIndex
CREATE INDEX "ChallengeEntry_userId_idx" ON "ChallengeEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeEntry_challengeId_userId_key" ON "ChallengeEntry"("challengeId", "userId");

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CheckConstraints (mirrors packages/shared/src/challenges.ts)
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_points_check" CHECK ("points" >= 0 AND "points" <= 500);
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_dates_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_url_check" CHECK ("url" LIKE 'https://%' AND char_length("url") <= 500);
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_note_check" CHECK (char_length("note") <= 1000);
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_feedback_check" CHECK ("feedback" IS NULL OR char_length("feedback") <= 1000);
