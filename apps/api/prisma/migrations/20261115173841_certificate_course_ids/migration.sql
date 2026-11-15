-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "certCode" TEXT;

-- CreateTable
CREATE TABLE "CertificateSequence" (
    "code" TEXT NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "CertificateSequence_pkey" PRIMARY KEY ("code")
);
