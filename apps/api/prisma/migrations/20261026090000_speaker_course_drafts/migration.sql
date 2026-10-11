-- A speaker's COURSE booking becomes a draft course (linked here) instead of a draft live
-- session. Additive: a nullable column, no existing row changes.

-- AlterTable
ALTER TABLE "SpeakingSlot" ADD COLUMN     "courseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingSlot_courseId_key" ON "SpeakingSlot"("courseId");

-- AddForeignKey
ALTER TABLE "SpeakingSlot" ADD CONSTRAINT "SpeakingSlot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
