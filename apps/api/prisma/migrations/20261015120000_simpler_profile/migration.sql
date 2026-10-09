-- The profile form is simpler: the education step only asks for the highest degree
-- (field of study and university are no longer required), and the links step only asks
-- for LinkedIn and GitHub (website, Kaggle, Hugging Face and the CV upload are gone).
-- No column is dropped and no saved value is changed; this only brings the two stored,
-- derived values in line with the new rule (packages/shared/src/profile.ts), as the app
-- would on the student's next save. Safe to run more than once.

-- 1. Profiles that now have every required field are complete. Nobody becomes
--    incomplete: requirements were only removed, so existing stamps are kept.
UPDATE "Profile"
SET "coreCompletedAt" = NOW()
WHERE "coreCompletedAt" IS NULL
  AND COALESCE("fullNameEn", '') <> ''
  AND COALESCE("phone", '') <> ''
  AND COALESCE("country", '') <> ''
  AND COALESCE("city", '') <> ''
  AND COALESCE("timezone", '') <> ''
  AND "employmentStatus" IS NOT NULL
  AND COALESCE("jobTitle", '') <> ''
  AND "experienceYears" IS NOT NULL
  AND "primaryArea" IS NOT NULL
  AND COALESCE("googleEmail", '') <> ''
  AND "preferredLanguage" IS NOT NULL
  AND "acceptedTermsAt" IS NOT NULL
  AND "mlExperienceYears" IS NOT NULL
  AND "seniority" IS NOT NULL
  AND "educationLevel" IS NOT NULL
  AND COALESCE("linkedinUrl", '') <> ''
  AND COALESCE("githubUrl", '') <> ''
  AND "referralSource" IS NOT NULL
  AND "communityAnsweredAt" IS NOT NULL;

-- 2. Completeness % (admins filter and sort on it): 19 required fields worth 60%,
--    11 optional fields worth 40%, as computeCompleteness does. Fields no longer asked
--    (field of study, university, graduation year, website) no longer count.
--    round((core/19)*60 + (optional/11)*40) = round((660*core + 760*optional) / 209).
UPDATE "Profile" p
SET "completeness" = c.percent
FROM (
  SELECT
    "id",
    ROUND((
      660 * (
          (COALESCE("fullNameEn", '') <> '')::int
        + (COALESCE("phone", '') <> '')::int
        + (COALESCE("country", '') <> '')::int
        + (COALESCE("city", '') <> '')::int
        + (COALESCE("timezone", '') <> '')::int
        + ("employmentStatus" IS NOT NULL)::int
        + (COALESCE("jobTitle", '') <> '')::int
        + ("experienceYears" IS NOT NULL)::int
        + ("primaryArea" IS NOT NULL)::int
        + (COALESCE("googleEmail", '') <> '')::int
        + ("preferredLanguage" IS NOT NULL)::int
        + ("acceptedTermsAt" IS NOT NULL)::int
        + ("mlExperienceYears" IS NOT NULL)::int
        + ("seniority" IS NOT NULL)::int
        + ("educationLevel" IS NOT NULL)::int
        + (COALESCE("linkedinUrl", '') <> '')::int
        + (COALESCE("githubUrl", '') <> '')::int
        + ("referralSource" IS NOT NULL)::int
        + ("communityAnsweredAt" IS NOT NULL)::int
      )
      + 760 * (
          (COALESCE("company", '') <> '')::int
        + ("industry" IS NOT NULL)::int
        + (COALESCE(cardinality("secondaryAreas"), 0) > 0)::int
        + (EXISTS (SELECT 1 FROM "SkillRating" s WHERE s."profileId" = "Profile"."id"))::int
        + (COALESCE(cardinality("cloudPlatforms"), 0) > 0)::int
        + (COALESCE(cardinality("productionTools"), 0) > 0)::int
        + (COALESCE(cardinality("learningGoals"), 0) > 0)::int
        + (COALESCE(cardinality("interestedTopics"), 0) > 0)::int
        + ("weeklyHours" IS NOT NULL)::int
        + (COALESCE(cardinality("preferredTimes"), 0) > 0)::int
        + ("preferredFormat" IS NOT NULL)::int
      )
    ) / 209.0)::int AS percent
  FROM "Profile"
) c
WHERE p."id" = c."id" AND p."completeness" <> c.percent;
