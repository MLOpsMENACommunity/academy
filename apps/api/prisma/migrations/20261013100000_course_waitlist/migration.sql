-- The waiting list for courses that are not open yet (additive: one new table).
-- CreateTable
CREATE TABLE "CourseInterest" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "announcementId" TEXT,
    "deliveryStatus" "DeliveryStatus",
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CourseInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseInterest_userId_idx" ON "CourseInterest"("userId");

-- CreateIndex
CREATE INDEX "CourseInterest_email_idx" ON "CourseInterest"("email");

-- CreateIndex
CREATE INDEX "CourseInterest_deliveryStatus_idx" ON "CourseInterest"("deliveryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CourseInterest_courseId_email_key" ON "CourseInterest"("courseId", "email");

-- AddForeignKey
ALTER TABLE "CourseInterest" ADD CONSTRAINT "CourseInterest_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInterest" ADD CONSTRAINT "CourseInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInterest" ADD CONSTRAINT "CourseInterest_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Content: no links to zomra.io on public pages (owner request). Removes the
-- "Originally hosted on zomra.io" line from imported live sessions and the platform
-- link from the completed MLOps Practitioner cohort; other text is untouched.
UPDATE "LiveEvent"
SET "descriptionEn" = regexp_replace("descriptionEn", '\s*Originally hosted on \[zomra\.io\]\([^)]*\)\.', '', 'g'),
    "descriptionAr" = regexp_replace("descriptionAr", '\s*استُضيفت الجلسة في الأصل على \[zomra\.io\]\([^)]*\)\.', '', 'g')
WHERE "descriptionEn" LIKE '%[zomra.io](https://zomra.io/%' OR "descriptionAr" LIKE '%[zomra.io](https://zomra.io/%';

UPDATE "Course"
SET "longDescriptionEn" = regexp_replace("longDescriptionEn", ' on \[zomra\.io\]\([^)]*\)', '', 'g'),
    "longDescriptionAr" = regexp_replace("longDescriptionAr", ' على \[zomra\.io\]\([^)]*\)', '', 'g'),
    "externalPlatform" = CASE WHEN lower("externalPlatform") = 'zomra.io' THEN NULL ELSE "externalPlatform" END,
    "externalUrl" = CASE WHEN "externalUrl" LIKE 'https://zomra.io/%' THEN NULL ELSE "externalUrl" END
WHERE "longDescriptionEn" LIKE '%[zomra.io](https://zomra.io/%' OR "longDescriptionAr" LIKE '%[zomra.io](https://zomra.io/%'
   OR lower("externalPlatform") = 'zomra.io' OR "externalUrl" LIKE 'https://zomra.io/%';
