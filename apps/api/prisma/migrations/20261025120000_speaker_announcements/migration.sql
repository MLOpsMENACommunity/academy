-- Speakers send announcements: to an assigned course's enrolled students, or to a live
-- session's registrants. Additive: existing rows keep their courseId and get no sender name.

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "fromNameAr" TEXT,
ALTER COLUMN "courseId" DROP NOT NULL;

-- Exactly one target: a course or a live session (every existing row has a course).
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_one_target" CHECK (("courseId" IS NULL) <> ("eventId" IS NULL));

-- CreateIndex
CREATE INDEX "Announcement_eventId_createdAt_idx" ON "Announcement"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_createdById_createdAt_idx" ON "Announcement"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LiveEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
