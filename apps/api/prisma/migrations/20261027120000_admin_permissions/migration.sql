-- Admin permission presets. Every existing admin gets SUPER, so nobody loses access.
-- Additive: a new enum and a new column with a default.

-- CreateEnum
CREATE TYPE "AdminPermission" AS ENUM ('SUPER', 'ACADEMIC', 'CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminPermissions" "AdminPermission"[] DEFAULT ARRAY[]::"AdminPermission"[];

-- Existing admins keep full access.
UPDATE "User" SET "adminPermissions" = ARRAY['SUPER']::"AdminPermission"[] WHERE "role" = 'ADMIN';
