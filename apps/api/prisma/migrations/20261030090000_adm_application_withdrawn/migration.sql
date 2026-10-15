-- Students can withdraw an application (and deleting an account withdraws its open ones). Additive only.

-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'WITHDRAWN';
