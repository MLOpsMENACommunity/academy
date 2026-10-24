-- Consultations: paid 1:1 calls with speakers (paid by InstaPay and checked by hand in v1).
-- Additive only: two new tables, so the previous release keeps working against this schema
-- (it never reads or writes them). Text plus CHECK constraints instead of new enums.
-- CreateTable
CREATE TABLE "ConsultantProfile" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "price30Egp" INTEGER,
    "price60Egp" INTEGER,
    "meetingUrl" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "minNoticeHours" INTEGER NOT NULL DEFAULT 24,
    "horizonDays" INTEGER NOT NULL DEFAULT 30,
    "availability" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationBooking" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "priceEgp" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "holdUntil" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultantProfile_instructorId_key" ON "ConsultantProfile"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationBooking_reference_key" ON "ConsultationBooking"("reference");

-- CreateIndex
CREATE INDEX "ConsultationBooking_consultantId_startsAt_idx" ON "ConsultationBooking"("consultantId", "startsAt");

-- CreateIndex
CREATE INDEX "ConsultationBooking_studentId_startsAt_idx" ON "ConsultationBooking"("studentId", "startsAt");

-- CreateIndex
CREATE INDEX "ConsultationBooking_status_holdUntil_idx" ON "ConsultationBooking"("status", "holdUntil");

-- CreateIndex
CREATE INDEX "ConsultationBooking_status_startsAt_idx" ON "ConsultationBooking"("status", "startsAt");

-- AddForeignKey
ALTER TABLE "ConsultantProfile" ADD CONSTRAINT "ConsultantProfile_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "ConsultantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_status_check" CHECK ("status" IN ('AWAITING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'));
ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_cancelledBy_check" CHECK ("cancelledBy" IS NULL OR "cancelledBy" IN ('student', 'expert', 'admin'));
ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_duration_check" CHECK ("durationMin" IN (30, 60) AND "endsAt" > "startsAt");
