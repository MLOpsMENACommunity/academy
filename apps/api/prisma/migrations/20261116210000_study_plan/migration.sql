-- Study plans for self-paced courses (one per student and course). Additive only: a new table
-- the previous release never reads. Checks keep the values the shared schema allows.
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "minutesPerDay" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "reminderHour" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudyPlan_weekdays_check" CHECK (cardinality("weekdays") BETWEEN 1 AND 7 AND "weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]),
    CONSTRAINT "StudyPlan_minutesPerDay_check" CHECK ("minutesPerDay" BETWEEN 15 AND 240),
    CONSTRAINT "StudyPlan_reminderHour_check" CHECK ("reminderHour" IS NULL OR "reminderHour" BETWEEN 0 AND 23)
);

CREATE UNIQUE INDEX "StudyPlan_userId_courseId_key" ON "StudyPlan"("userId", "courseId");
CREATE INDEX "StudyPlan_courseId_idx" ON "StudyPlan"("courseId");

ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
