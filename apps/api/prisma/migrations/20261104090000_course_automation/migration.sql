-- Course automation rules: per-course rules and the log of what they did. Additive only: two new
-- tables, a column with a default and a new points reason, so the previous release keeps working
-- against this schema (it never reads or writes them).
-- AlterEnum
ALTER TYPE "PointsReason" ADD VALUE 'AUTOMATION';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "automationPaused" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CourseAutomationRule" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "params" JSONB NOT NULL DEFAULT '{}',
    "noteEn" TEXT NOT NULL DEFAULT '',
    "noteAr" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationFiring" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "userId" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "actions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationFiring_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseAutomationRule_courseId_type_key" ON "CourseAutomationRule"("courseId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationFiring_ruleId_dedupeKey_key" ON "AutomationFiring"("ruleId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AutomationFiring_courseId_createdAt_idx" ON "AutomationFiring"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationFiring_courseId_type_createdAt_idx" ON "AutomationFiring"("courseId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "CourseAutomationRule" ADD CONSTRAINT "CourseAutomationRule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAutomationRule" ADD CONSTRAINT "CourseAutomationRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationFiring" ADD CONSTRAINT "AutomationFiring_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CourseAutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationFiring" ADD CONSTRAINT "AutomationFiring_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
