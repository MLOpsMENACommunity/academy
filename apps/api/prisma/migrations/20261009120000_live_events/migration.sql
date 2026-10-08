-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LiveEvent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "speakerName" TEXT NOT NULL DEFAULT '',
    "speakerNameAr" TEXT NOT NULL DEFAULT '',
    "speakerTitleEn" TEXT NOT NULL DEFAULT '',
    "speakerTitleAr" TEXT NOT NULL DEFAULT '',
    "speakerPhotoUrl" TEXT,
    "speakerLinkedinUrl" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "language" "CourseLanguage" NOT NULL DEFAULT 'BILINGUAL',
    "platform" "DeliveryPlatform" NOT NULL DEFAULT 'GOOGLE_MEET',
    "liveUrl" TEXT,
    "recordingUrl" TEXT,
    "coverImageUrl" TEXT,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventReminderLog" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminderLog_pkey" PRIMARY KEY ("eventId","userId","kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveEvent_slug_key" ON "LiveEvent"("slug");

-- CreateIndex
CREATE INDEX "LiveEvent_status_startsAt_idx" ON "LiveEvent"("status", "startsAt");

-- CreateIndex
CREATE INDEX "EventRegistration_userId_idx" ON "EventRegistration"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_userId_key" ON "EventRegistration"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LiveEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminderLog" ADD CONSTRAINT "EventReminderLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LiveEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminderLog" ADD CONSTRAINT "EventReminderLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

