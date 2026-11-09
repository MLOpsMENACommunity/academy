-- Self-paced free courses: video lessons, optional lessons, and attendance certificates.
CREATE TYPE "LessonCompletionSource" AS ENUM ('WATCHED', 'MANUAL');
CREATE TYPE "CertificateKind" AS ENUM ('COMPLETION', 'ATTENDANCE');

ALTER TABLE "Course" ADD COLUMN "selfPaced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CourseSession" ADD COLUMN "optional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SessionProgress" ADD COLUMN "source" "LessonCompletionSource";
ALTER TABLE "Certificate" ADD COLUMN "kind" "CertificateKind" NOT NULL DEFAULT 'COMPLETION';
