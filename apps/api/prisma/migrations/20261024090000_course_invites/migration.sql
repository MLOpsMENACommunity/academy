-- "Enrol by email": admins add people to a course by address (see CourseInvite in schema.prisma).

-- CreateEnum
CREATE TYPE "CourseInviteStatus" AS ENUM ('PENDING', 'ENROLLED', 'REVOKED');

-- CreateTable
CREATE TABLE "CourseInvite" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "invitedById" TEXT,
    "note" TEXT,
    "status" "CourseInviteStatus" NOT NULL DEFAULT 'PENDING',
    "enrolledUserId" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "lastEmailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseInvite_email_status_idx" ON "CourseInvite"("email", "status");

-- CreateIndex
CREATE INDEX "CourseInvite_status_createdAt_idx" ON "CourseInvite"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CourseInvite_enrolledUserId_idx" ON "CourseInvite"("enrolledUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseInvite_courseId_email_key" ON "CourseInvite"("courseId", "email");

-- AddForeignKey
ALTER TABLE "CourseInvite" ADD CONSTRAINT "CourseInvite_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInvite" ADD CONSTRAINT "CourseInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInvite" ADD CONSTRAINT "CourseInvite_enrolledUserId_fkey" FOREIGN KEY ("enrolledUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

