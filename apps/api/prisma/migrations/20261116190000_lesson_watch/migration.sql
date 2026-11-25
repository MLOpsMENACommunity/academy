-- Resume at the exact second: where each student stopped in a session's video. Additive.

-- CreateTable
CREATE TABLE "LessonWatch" (
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "positionSec" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonWatch_pkey" PRIMARY KEY ("userId","sessionId")
);

-- CreateIndex
CREATE INDEX "LessonWatch_sessionId_idx" ON "LessonWatch"("sessionId");

-- AddForeignKey
ALTER TABLE "LessonWatch" ADD CONSTRAINT "LessonWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWatch" ADD CONSTRAINT "LessonWatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
