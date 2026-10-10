-- Certificates: issue from admin, public verification, PDF. Additive, plus the enrolment
-- foreign key moves from CASCADE to RESTRICT so an issued certificate is never deleted with it.
-- The table has never been written to by the app; the defaults below only exist so the NOT NULL
-- columns can be added even if a row was created by hand, and are dropped straight after.

-- DropForeignKey
ALTER TABLE "Certificate" DROP CONSTRAINT "Certificate_enrollmentId_fkey";

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "courseTitleAr" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "courseTitleEn" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "instructorNames" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "nameOnCertificate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "nameOnCertificateAr" TEXT,
ADD COLUMN     "pdfKey" TEXT,
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Certificate" ALTER COLUMN "courseTitleAr" DROP DEFAULT,
ALTER COLUMN "courseTitleEn" DROP DEFAULT,
ALTER COLUMN "nameOnCertificate" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "certMinSessionsPercent" INTEGER,
ADD COLUMN     "certRequireAssessments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "certRuleAr" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "certRuleEn" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Certificate_issuedAt_idx" ON "Certificate"("issuedAt");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
