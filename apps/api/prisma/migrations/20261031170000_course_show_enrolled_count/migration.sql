-- Course pages show how many students are enrolled; an admin can hide it per course. Additive only.

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "showEnrolledCount" BOOLEAN NOT NULL DEFAULT true;
