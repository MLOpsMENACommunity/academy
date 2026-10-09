-- Hosts and guests of a live session besides its main speaker (additive: one enum, one table).
-- CreateEnum
CREATE TYPE "EventSpeakerRole" AS ENUM ('SPEAKER', 'HOST', 'GUEST');

-- CreateTable
CREATE TABLE "LiveEventSpeaker" (
    "eventId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "role" "EventSpeakerRole" NOT NULL DEFAULT 'GUEST',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LiveEventSpeaker_pkey" PRIMARY KEY ("eventId","instructorId")
);

-- CreateIndex
CREATE INDEX "LiveEventSpeaker_instructorId_idx" ON "LiveEventSpeaker"("instructorId");

-- AddForeignKey
ALTER TABLE "LiveEventSpeaker" ADD CONSTRAINT "LiveEventSpeaker_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LiveEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveEventSpeaker" ADD CONSTRAINT "LiveEventSpeaker_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
