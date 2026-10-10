-- CreateEnum
CREATE TYPE "SpeakerArea" AS ENUM ('MLOPS', 'LLMOPS', 'KUBERNETES', 'CLOUD_DEVOPS', 'DATA_ENGINEERING', 'AI_ARCHITECTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "SpeakerFormat" AS ENUM ('TALK', 'HANDS_ON', 'WORKSHOP', 'QA');

-- CreateEnum
CREATE TYPE "SpeakerApplicationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'BOOKED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SPEAKER';

-- AlterTable
ALTER TABLE "Instructor" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "SpeakerApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SpeakerApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "linkedinUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "photoUrl" TEXT,
    "areas" "SpeakerArea"[],
    "sessionTitle" TEXT NOT NULL,
    "abstract" TEXT NOT NULL,
    "format" "SpeakerFormat" NOT NULL,
    "language" "CourseLanguage" NOT NULL,
    "preferredMonths" TEXT[],
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submissions" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakingSlot" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "bookedById" TEXT,
    "bookedAt" TIMESTAMP(3),
    "title" TEXT,
    "abstract" TEXT,
    "eventId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerApplication_userId_key" ON "SpeakerApplication"("userId");

-- CreateIndex
CREATE INDEX "SpeakerApplication_status_submittedAt_idx" ON "SpeakerApplication"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingSlot_eventId_key" ON "SpeakingSlot"("eventId");

-- CreateIndex
CREATE INDEX "SpeakingSlot_status_startsAt_idx" ON "SpeakingSlot"("status", "startsAt");

-- CreateIndex
CREATE INDEX "SpeakingSlot_bookedById_status_idx" ON "SpeakingSlot"("bookedById", "status");

-- CreateIndex
CREATE INDEX "SpeakingSlot_startsAt_idx" ON "SpeakingSlot"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Instructor_userId_key" ON "Instructor"("userId");

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerApplication" ADD CONSTRAINT "SpeakerApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerApplication" ADD CONSTRAINT "SpeakerApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingSlot" ADD CONSTRAINT "SpeakingSlot_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingSlot" ADD CONSTRAINT "SpeakingSlot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LiveEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingSlot" ADD CONSTRAINT "SpeakingSlot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

