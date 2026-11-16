-- Practice exams from a question bank. Additive only: nullable or defaulted columns, so the
-- previous release keeps working against this schema (it never reads or writes them).

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "balanceByTopic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "drawCount" INTEGER;

-- AlterTable
ALTER TABLE "QuizQuestion" ADD COLUMN     "topic" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "drawnQuestionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Limits (the API validates the same; these keep bad rows out whatever writes them).
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_drawCount_check" CHECK ("drawCount" IS NULL OR "drawCount" > 0);
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_topic_check" CHECK ("topic" IS NULL OR char_length("topic") <= 60);
