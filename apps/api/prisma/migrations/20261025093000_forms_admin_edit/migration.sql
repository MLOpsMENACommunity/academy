-- Speaker form: Course and Podcast formats, a kind (session / course / podcast) with optional
-- details, "How did you hear about us?" with a referring member, an optional GitHub link.
ALTER TYPE "SpeakerFormat" ADD VALUE 'COURSE';
ALTER TYPE "SpeakerFormat" ADD VALUE 'PODCAST';

CREATE TYPE "SpeakerKind" AS ENUM ('SESSION', 'COURSE', 'PODCAST');
CREATE TYPE "SpeakerReferralSource" AS ENUM ('MAIN_SITE', 'LINKEDIN', 'FACEBOOK', 'X_TWITTER', 'YOUTUBE', 'DISCORD', 'TELEGRAM', 'WHATSAPP', 'FRIEND_COLLEAGUE', 'EVENT', 'SEARCH', 'MLOPS_MENA_MEMBER', 'OTHER');

ALTER TABLE "SpeakerApplication"
  ADD COLUMN "githubUrl" TEXT,
  ADD COLUMN "kind" "SpeakerKind" NOT NULL DEFAULT 'SESSION',
  ADD COLUMN "referralSource" "SpeakerReferralSource",
  ADD COLUMN "referralMemberName" TEXT,
  ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "SpeakingSlot"
  ADD COLUMN "kind" "SpeakerKind",
  ADD COLUMN "details" JSONB;

-- Existing bookings were sessions.
UPDATE "SpeakingSlot" SET "kind" = 'SESSION' WHERE "status" = 'BOOKED' AND "kind" IS NULL;

ALTER TABLE "LiveEvent" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';

-- Admins can change a speaker's page address: the old one redirects.
ALTER TABLE "Instructor" ADD COLUMN "previousSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "Instructor_previousSlugs_idx" ON "Instructor" USING GIN ("previousSlugs");
