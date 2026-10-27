-- Automatic Drive sharing: why the last attempt failed, and when. Additive only (two nullable
-- columns), so the previous release keeps working against this schema.
-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "driveShareError" TEXT,
ADD COLUMN "driveShareTriedAt" TIMESTAMP(3);
