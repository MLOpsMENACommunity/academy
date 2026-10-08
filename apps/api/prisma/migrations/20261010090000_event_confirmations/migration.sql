-- CreateTable
CREATE TABLE "EventConfirmation" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventConfirmation_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "EventConfirmation_userId_idx" ON "EventConfirmation"("userId");

-- AddForeignKey
ALTER TABLE "EventConfirmation" ADD CONSTRAINT "EventConfirmation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LiveEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventConfirmation" ADD CONSTRAINT "EventConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

