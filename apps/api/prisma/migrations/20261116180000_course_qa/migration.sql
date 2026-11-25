-- Course Q&A: students' questions in a course, answers, "I have this question too" votes and
-- follows. Additive only: four new tables and two new enum values (a points reason and a course
-- permission), so the previous release keeps working against this schema (it never reads or
-- writes them). The question status is text plus a CHECK constraint, not a new enum. The new
-- permission is given to the built-in roles in the next migration: Postgres can't use an enum
-- value added in the same transaction.
-- AlterEnum
ALTER TYPE "PointsReason" ADD VALUE 'QA_ANSWER';

-- AlterEnum
ALTER TYPE "CoursePermission" ADD VALUE 'ANSWER_QUESTIONS';

-- CreateTable
CREATE TABLE "CourseQuestion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "acceptedAnswerId" TEXT,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "answerCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVote" (
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVote_pkey" PRIMARY KEY ("questionId","userId")
);

-- CreateTable
CREATE TABLE "QuestionFollow" (
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionFollow_pkey" PRIMARY KEY ("questionId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseQuestion_acceptedAnswerId_key" ON "CourseQuestion"("acceptedAnswerId");

-- CreateIndex
CREATE INDEX "CourseQuestion_courseId_status_lastActivityAt_idx" ON "CourseQuestion"("courseId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "CourseQuestion_courseId_sessionId_idx" ON "CourseQuestion"("courseId", "sessionId");

-- CreateIndex
CREATE INDEX "CourseQuestion_authorId_idx" ON "CourseQuestion"("authorId");

-- CreateIndex
CREATE INDEX "CourseAnswer_questionId_createdAt_idx" ON "CourseAnswer"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "CourseAnswer_authorId_idx" ON "CourseAnswer"("authorId");

-- CreateIndex
CREATE INDEX "QuestionVote_userId_idx" ON "QuestionVote"("userId");

-- CreateIndex
CREATE INDEX "QuestionFollow_userId_idx" ON "QuestionFollow"("userId");

-- AddForeignKey
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_acceptedAnswerId_fkey" FOREIGN KEY ("acceptedAnswerId") REFERENCES "CourseAnswer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAnswer" ADD CONSTRAINT "CourseAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAnswer" ADD CONSTRAINT "CourseAnswer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAnswer" ADD CONSTRAINT "CourseAnswer_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVote" ADD CONSTRAINT "QuestionVote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVote" ADD CONSTRAINT "QuestionVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFollow" ADD CONSTRAINT "QuestionFollow_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFollow" ADD CONSTRAINT "QuestionFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Status and counters
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_status_check" CHECK ("status" IN ('OPEN', 'ANSWERED', 'CLOSED'));
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_counts_check" CHECK ("voteCount" >= 0 AND "answerCount" >= 0);
