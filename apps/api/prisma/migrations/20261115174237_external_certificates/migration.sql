-- CreateTable
CREATE TABLE "ExternalCertificate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "kind" "CertificateKind" NOT NULL DEFAULT 'ATTENDANCE',
    "issuedOn" DATE NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "email" TEXT,
    "userId" TEXT,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCertificate_code_key" ON "ExternalCertificate"("code");

-- CreateIndex
CREATE INDEX "ExternalCertificate_email_idx" ON "ExternalCertificate"("email");

-- CreateIndex
CREATE INDEX "ExternalCertificate_userId_idx" ON "ExternalCertificate"("userId");

-- AddForeignKey
ALTER TABLE "ExternalCertificate" ADD CONSTRAINT "ExternalCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCertificate" ADD CONSTRAINT "ExternalCertificate_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
