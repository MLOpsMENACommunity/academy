-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "driveRevokeEmail" TEXT;

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "authMethod" TEXT NOT NULL DEFAULT 'pwd',
ADD COLUMN     "authTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
