-- Assessments: quizzes, labs and assignments with submissions and grades (additive only).

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('QUIZ', 'LAB', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('GITHUB_REPO', 'DRIVE_LINK', 'PDF', 'LINK');

-- CreateEnum
CREATE TYPE "ScoringPolicy" AS ENUM ('BEST', 'LAST');

-- CreateEnum
CREATE TYPE "RevealPolicy" AS ENUM ('NEVER', 'AFTER_SUBMIT', 'AFTER_DUE');

-- CreateEnum
CREATE TYPE "QuizQuestionKind" AS ENUM ('SINGLE', 'MULTIPLE', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "RepoCheck" AS ENUM ('PUBLIC', 'NOT_PUBLIC', 'UNVERIFIED');

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "type" "AssessmentType" NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "order" INTEGER NOT NULL DEFAULT 0,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "instructionsEn" TEXT NOT NULL DEFAULT '',
    "instructionsAr" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3),
    "allowLate" BOOLEAN NOT NULL DEFAULT true,
    "maxPoints" INTEGER NOT NULL DEFAULT 100,
    "passPercent" INTEGER NOT NULL DEFAULT 70,
    "countsForCertificate" BOOLEAN NOT NULL DEFAULT false,
    "submissionKind" "SubmissionKind",
    "attemptsAllowed" INTEGER NOT NULL DEFAULT 1,
    "scoring" "ScoringPolicy" NOT NULL DEFAULT 'BEST',
    "revealAnswers" "RevealPolicy" NOT NULL DEFAULT 'AFTER_SUBMIT',
    "timeLimitMin" INTEGER,
    "shuffle" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "QuizQuestionKind" NOT NULL,
    "promptEn" TEXT NOT NULL,
    "promptAr" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "explanationEn" TEXT,
    "explanationAr" TEXT,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuizOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "answers" JSONB,
    "url" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileDeletedAt" TIMESTAMP(3),
    "note" TEXT,
    "attested" BOOLEAN NOT NULL DEFAULT false,
    "repoCheck" "RepoCheck",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,
    "maxScore" INTEGER NOT NULL,
    "gradedAt" TIMESTAMP(3),
    "gradedById" TEXT,
    "feedback" TEXT,
    "rubricNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentReminderLog" (
    "assessmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentReminderLog_pkey" PRIMARY KEY ("assessmentId","userId")
);

-- CreateIndex
CREATE INDEX "Assessment_courseId_status_order_idx" ON "Assessment"("courseId", "status", "order");

-- CreateIndex
CREATE INDEX "Assessment_sessionId_idx" ON "Assessment"("sessionId");

-- CreateIndex
CREATE INDEX "Assessment_status_dueAt_idx" ON "Assessment"("status", "dueAt");

-- CreateIndex
CREATE INDEX "QuizQuestion_assessmentId_order_idx" ON "QuizQuestion"("assessmentId", "order");

-- CreateIndex
CREATE INDEX "QuizOption_questionId_order_idx" ON "QuizOption"("questionId", "order");

-- CreateIndex
CREATE INDEX "Submission_userId_idx" ON "Submission"("userId");

-- CreateIndex
CREATE INDEX "Submission_assessmentId_submittedAt_idx" ON "Submission"("assessmentId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_assessmentId_userId_attempt_key" ON "Submission"("assessmentId", "userId", "attempt");

-- CreateIndex
CREATE INDEX "AssessmentReminderLog_userId_idx" ON "AssessmentReminderLog"("userId");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizOption" ADD CONSTRAINT "QuizOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentReminderLog" ADD CONSTRAINT "AssessmentReminderLog_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentReminderLog" ADD CONSTRAINT "AssessmentReminderLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

