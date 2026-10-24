-- Consultations: a paid call can be moved once (no refunds), each call keeps its own link, and
-- experts can connect Google Calendar. Additive only: nullable columns and columns with defaults.
-- AlterTable
ALTER TABLE "ConsultantProfile" ADD COLUMN     "googleConnectedAt" TIMESTAMP(3),
ADD COLUMN     "googleEmail" TEXT,
ADD COLUMN     "googleError" TEXT,
ADD COLUMN     "googleRefreshToken" TEXT;

-- AlterTable
ALTER TABLE "ConsultationBooking" ADD COLUMN     "googleEventId" TEXT,
ADD COLUMN     "meetingUrl" TEXT,
ADD COLUMN     "rescheduleCount" INTEGER NOT NULL DEFAULT 0;

