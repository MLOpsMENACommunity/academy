-- Points, badges and course leaderboards (additive).


-- CreateEnum
CREATE TYPE "PointsReason" AS ENUM ('ASSESSMENT', 'SESSION_COMPLETED', 'CERTIFICATE', 'MANUAL_COMMUNITY', 'MANUAL_OTHER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BadgeKind" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "PointsEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "points" INTEGER NOT NULL,
    "reason" "PointsReason" NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceSeq" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "awardedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL,
    "kind" "BadgeKind" NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "courseId" TEXT,
    "period" INTEGER,
    "scopeKey" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awardedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardOptIn" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardOptIn_pkey" PRIMARY KEY ("userId","courseId")
);

-- CreateIndex
CREATE INDEX "PointsEntry_userId_createdAt_idx" ON "PointsEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsEntry_courseId_createdAt_idx" ON "PointsEntry"("courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointsEntry_userId_sourceType_sourceId_sourceSeq_key" ON "PointsEntry"("userId", "sourceType", "sourceId", "sourceSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_code_key" ON "Badge"("code");

-- CreateIndex
CREATE INDEX "UserBadge_courseId_idx" ON "UserBadge"("courseId");

-- CreateIndex
CREATE INDEX "UserBadge_userId_awardedAt_idx" ON "UserBadge"("userId", "awardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_scopeKey_key" ON "UserBadge"("userId", "badgeId", "scopeKey");

-- CreateIndex
CREATE INDEX "LeaderboardOptIn_courseId_optedIn_idx" ON "LeaderboardOptIn"("courseId", "optedIn");

-- AddForeignKey
ALTER TABLE "PointsEntry" ADD CONSTRAINT "PointsEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsEntry" ADD CONSTRAINT "PointsEntry_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsEntry" ADD CONSTRAINT "PointsEntry_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardOptIn" ADD CONSTRAINT "LeaderboardOptIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardOptIn" ADD CONSTRAINT "LeaderboardOptIn_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the built-in badges (automatic ones are looked up by code). Re-running is harmless.
INSERT INTO "Badge" ("id", "code", "nameEn", "nameAr", "descriptionEn", "descriptionAr", "icon", "kind") VALUES
  ('badge_top_week', 'top-week', 'Top of the week', 'الأفضل هذا الأسبوع', 'Top 3 in points in a course week.', 'من أعلى 3 في النقاط خلال أسبوع من الدورة.', '🏅', 'AUTO'),
  ('badge_top_course', 'top-course', 'Top of the course', 'الأفضل في الدورة', 'Top 3 in points when the course ended.', 'من أعلى 3 في النقاط عند انتهاء الدورة.', '🏆', 'AUTO'),
  ('badge_perfect_score', 'perfect-score', 'Perfect score', 'العلامة الكاملة', 'Scored 100% on a quiz.', 'حصلت على 100% في اختبار.', '💯', 'AUTO'),
  ('badge_finisher', 'finisher', 'Finisher', 'أتممت الدورة', 'Completed every session of the course.', 'أكملت كل جلسات الدورة.', '🏁', 'AUTO'),
  ('badge_certified', 'certified', 'Certified', 'حاصل على الشهادة', 'Earned the course certificate.', 'حصلت على شهادة الدورة.', '🎓', 'AUTO'),
  ('badge_top_performer', 'top-performer', 'Top performer', 'أداء متميز', 'Recognised by the course team for outstanding work.', 'تقدير من فريق الدورة لعمل متميز.', '⭐', 'MANUAL'),
  ('badge_community_helper', 'community-helper', 'Community helper', 'عون المجتمع', 'Helped others in the community.', 'ساعدت الآخرين في المجتمع.', '🤝', 'MANUAL'),
  ('badge_speaker', 'speaker', 'Speaker', 'متحدث', 'Delivered a session for the community.', 'قدّمت جلسة للمجتمع.', '🎤', 'MANUAL')
ON CONFLICT ("code") DO NOTHING;
