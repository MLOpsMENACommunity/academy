-- Optional per-course payment link. Additive only: one nullable column, so the previous release
-- keeps working against this schema (it never reads or writes it).
-- AlterTable
ALTER TABLE "Course" ADD COLUMN "paymentUrl" TEXT;
