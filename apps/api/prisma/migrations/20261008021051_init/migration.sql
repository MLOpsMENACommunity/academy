-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ar');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('EMPLOYED_FULL_TIME', 'EMPLOYED_PART_TIME', 'FREELANCER', 'STUDENT', 'JOB_SEEKING', 'OTHER');

-- CreateEnum
CREATE TYPE "ExperienceRange" AS ENUM ('Y0_1', 'Y1_3', 'Y3_5', 'Y5_10', 'Y10_PLUS');

-- CreateEnum
CREATE TYPE "Area" AS ENUM ('ML_ENGINEERING', 'MLOPS', 'LLMOPS_AI_ENGINEERING', 'DATA_SCIENCE', 'DATA_ENGINEERING', 'SOFTWARE_BACKEND', 'DEVOPS_PLATFORM_SRE', 'RESEARCH', 'STUDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "Industry" AS ENUM ('FINTECH', 'TELECOM', 'HEALTHCARE', 'ECOMMERCE', 'GOVERNMENT', 'CONSULTING', 'ACADEMIA', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD_STAFF', 'MANAGER', 'HEAD_DIRECTOR');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('HIGH_SCHOOL', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'PHD', 'BOOTCAMP_SELF_TAUGHT');

-- CreateEnum
CREATE TYPE "Skill" AS ENUM ('PYTHON', 'SQL', 'LINUX_BASH', 'GIT', 'DOCKER', 'KUBERNETES', 'CI_CD', 'AWS', 'GCP', 'AZURE', 'ML_FUNDAMENTALS', 'DEEP_LEARNING', 'LLMS_RAG', 'AGENTS', 'MLOPS_TOOLING', 'MONITORING_OBSERVABILITY');

-- CreateEnum
CREATE TYPE "CloudPlatform" AS ENUM ('AWS', 'GCP', 'AZURE', 'ORACLE', 'ALIBABA', 'OTHER');

-- CreateEnum
CREATE TYPE "LearningGoal" AS ENUM ('FIRST_ML_JOB', 'MOVE_TO_MLOPS', 'LEVEL_UP_SENIOR', 'LEAD_TEAM', 'BUILD_PRODUCT', 'FREELANCING', 'RESEARCH');

-- CreateEnum
CREATE TYPE "Topic" AS ENUM ('MLOPS', 'LLMOPS', 'KUBERNETES', 'RAG', 'AGENTS', 'AI_ARCHITECTURE', 'CLOUD', 'DATA_ENGINEERING', 'COMPUTER_VISION', 'NLP', 'DEEP_LEARNING', 'MONITORING', 'SECURITY_GOVERNANCE');

-- CreateEnum
CREATE TYPE "WeeklyHours" AS ENUM ('H_LT_2', 'H_2_5', 'H_5_10', 'H_10_PLUS');

-- CreateEnum
CREATE TYPE "SessionTime" AS ENUM ('WEEKDAY_MORNINGS', 'WEEKDAY_EVENINGS', 'WEEKEND_MORNINGS', 'WEEKEND_EVENINGS');

-- CreateEnum
CREATE TYPE "LearningFormat" AS ENUM ('LIVE', 'RECORDED', 'HYBRID');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('MAIN_SITE', 'LINKEDIN', 'FACEBOOK', 'X_TWITTER', 'YOUTUBE', 'DISCORD', 'TELEGRAM', 'WHATSAPP', 'FRIEND_COLLEAGUE', 'EVENT', 'SEARCH', 'OTHER');

-- CreateEnum
CREATE TYPE "CourseType" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS');

-- CreateEnum
CREATE TYPE "CourseLanguage" AS ENUM ('EN', 'AR', 'BILINGUAL');

-- CreateEnum
CREATE TYPE "DeliveryPlatform" AS ENUM ('GOOGLE_MEET', 'YOUTUBE_LIVE');

-- CreateEnum
CREATE TYPE "RecordingsPlatform" AS ENUM ('YOUTUBE', 'GOOGLE_DRIVE');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_SELECT', 'MULTI_SELECT', 'YES_NO', 'NUMBER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'SHORTLISTED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAYMENT_REJECTED', 'ENROLLED', 'REJECTED', 'WAITLISTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('INSTAPAY', 'VODAFONE_CASH', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SavedFilterScope" AS ENUM ('APPLICATIONS', 'STUDENTS');

-- CreateEnum
CREATE TYPE "FunnelEvent" AS ENUM ('COURSE_VIEW', 'APPLY_CLICKED', 'REGISTERED', 'PROFILE_COMPLETED', 'APPLICATION_SUBMITTED', 'SHORTLISTED', 'PAYMENT_SUBMITTED', 'ENROLLED');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('H24', 'H1');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pendingEmail" TEXT,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "returnTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullNameEn" TEXT,
    "fullNameAr" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "employmentStatus" "EmploymentStatus",
    "jobTitle" TEXT,
    "experienceYears" "ExperienceRange",
    "primaryArea" "Area",
    "googleEmail" TEXT,
    "preferredLanguage" "Locale",
    "acceptedTermsAt" TIMESTAMP(3),
    "company" TEXT,
    "industry" "Industry",
    "companySize" "CompanySize",
    "mlExperienceYears" "ExperienceRange",
    "seniority" "Seniority",
    "secondaryAreas" "Area"[],
    "educationLevel" "EducationLevel",
    "fieldOfStudy" TEXT,
    "university" TEXT,
    "graduationYear" INTEGER,
    "currentlyStudying" BOOLEAN,
    "cloudPlatforms" "CloudPlatform"[],
    "productionTools" TEXT[],
    "learningGoals" "LearningGoal"[],
    "interestedTopics" "Topic"[],
    "weeklyHours" "WeeklyHours",
    "preferredTimes" "SessionTime"[],
    "preferredFormat" "LearningFormat",
    "linkedinUrl" TEXT,
    "githubUrl" TEXT,
    "websiteUrl" TEXT,
    "kaggleUrl" TEXT,
    "huggingfaceUrl" TEXT,
    "cvKey" TEXT,
    "cvUploadedAt" TIMESTAMP(3),
    "referralSource" "ReferralSource",
    "communityMember" BOOLEAN,
    "openToOpportunities" BOOLEAN NOT NULL DEFAULT false,
    "shareWithPartners" BOOLEAN NOT NULL DEFAULT false,
    "marketingEmails" BOOLEAN NOT NULL DEFAULT false,
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "coreCompletedAt" TIMESTAMP(3),
    "reviewPromptSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillRating" (
    "profileId" TEXT NOT NULL,
    "skill" "Skill" NOT NULL,
    "level" INTEGER NOT NULL,

    CONSTRAINT "SkillRating_pkey" PRIMARY KEY ("profileId","skill")
);

-- CreateTable
CREATE TABLE "Instructor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT,
    "bioEn" TEXT NOT NULL,
    "bioAr" TEXT,
    "photoUrl" TEXT,
    "linkedinUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "shortDescriptionEn" TEXT NOT NULL,
    "shortDescriptionAr" TEXT NOT NULL,
    "longDescriptionEn" TEXT NOT NULL,
    "longDescriptionAr" TEXT NOT NULL,
    "type" "CourseType" NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "capacity" INTEGER,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "level" "CourseLevel" NOT NULL DEFAULT 'ALL_LEVELS',
    "language" "CourseLanguage" NOT NULL DEFAULT 'BILINGUAL',
    "startDate" TIMESTAMP(3),
    "applicationsOpenAt" TIMESTAMP(3),
    "applicationDeadline" TIMESTAMP(3),
    "durationWeeks" INTEGER,
    "hoursPerWeek" INTEGER,
    "coverImageUrl" TEXT,
    "targetAudience" JSONB NOT NULL,
    "notFor" JSONB NOT NULL,
    "learningOutcomes" JSONB NOT NULL,
    "prerequisites" JSONB NOT NULL,
    "outline" JSONB NOT NULL,
    "faq" JSONB NOT NULL,
    "included" JSONB NOT NULL,
    "deliveryPlatform" "DeliveryPlatform" NOT NULL DEFAULT 'GOOGLE_MEET',
    "recordingsPlatform" "RecordingsPlatform" NOT NULL DEFAULT 'YOUTUBE',
    "driveFolderUrl" TEXT,
    "youtubePlaylistUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseInstructor" (
    "courseId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CourseInstructor_pkey" PRIMARY KEY ("courseId","instructorId")
);

-- CreateTable
CREATE TABLE "ScreeningQuestion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "helpEn" TEXT,
    "helpAr" TEXT,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScreeningQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSession" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 90,
    "liveUrl" TEXT,
    "recordingUrl" TEXT,
    "materials" JSONB NOT NULL DEFAULT '[]',
    "assignmentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "answers" JSONB NOT NULL,
    "profileSnapshot" JSONB NOT NULL,
    "source" JSONB NOT NULL DEFAULT '{}',
    "ref" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationStatusHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "transactionRef" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderPhone" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "screenshotKey" TEXT,
    "screenshotSha256" TEXT,
    "screenshotMime" TEXT,
    "screenshotDeletedAt" TIMESTAMP(3),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "verifiedInHistory" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "applicationId" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driveAccessGranted" BOOLEAN NOT NULL DEFAULT false,
    "driveAccessGrantedAt" TIMESTAMP(3),

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSubmission" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "passed" BOOLEAN,

    CONSTRAINT "ProjectSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionProgress" (
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionProgress_pkey" PRIMARY KEY ("userId","sessionId")
);

-- CreateTable
CREATE TABLE "SessionFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderPreference" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "emailReminders" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReminderPreference_pkey" PRIMARY KEY ("userId","courseId")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("sessionId","userId","kind")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "authorId" TEXT,
    "subjectUserId" TEXT NOT NULL,
    "applicationId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scope" "SavedFilterScope" NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelEventLog" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "event" "FunnelEvent" NOT NULL,
    "anonymousId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Profile_country_idx" ON "Profile"("country");

-- CreateIndex
CREATE INDEX "Profile_experienceYears_idx" ON "Profile"("experienceYears");

-- CreateIndex
CREATE INDEX "Profile_mlExperienceYears_idx" ON "Profile"("mlExperienceYears");

-- CreateIndex
CREATE INDEX "Profile_seniority_idx" ON "Profile"("seniority");

-- CreateIndex
CREATE INDEX "Profile_primaryArea_idx" ON "Profile"("primaryArea");

-- CreateIndex
CREATE INDEX "Profile_employmentStatus_idx" ON "Profile"("employmentStatus");

-- CreateIndex
CREATE INDEX "Profile_educationLevel_idx" ON "Profile"("educationLevel");

-- CreateIndex
CREATE INDEX "Profile_weeklyHours_idx" ON "Profile"("weeklyHours");

-- CreateIndex
CREATE INDEX "Profile_openToOpportunities_idx" ON "Profile"("openToOpportunities");

-- CreateIndex
CREATE INDEX "Profile_secondaryAreas_idx" ON "Profile" USING GIN ("secondaryAreas");

-- CreateIndex
CREATE INDEX "Profile_interestedTopics_idx" ON "Profile" USING GIN ("interestedTopics");

-- CreateIndex
CREATE INDEX "Profile_cloudPlatforms_idx" ON "Profile" USING GIN ("cloudPlatforms");

-- CreateIndex
CREATE INDEX "SkillRating_skill_level_idx" ON "SkillRating"("skill", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");

-- CreateIndex
CREATE INDEX "Course_status_idx" ON "Course"("status");

-- CreateIndex
CREATE INDEX "ScreeningQuestion_courseId_idx" ON "ScreeningQuestion"("courseId");

-- CreateIndex
CREATE INDEX "CourseSession_courseId_order_idx" ON "CourseSession"("courseId", "order");

-- CreateIndex
CREATE INDEX "CourseSession_startsAt_idx" ON "CourseSession"("startsAt");

-- CreateIndex
CREATE INDEX "Application_courseId_status_idx" ON "Application"("courseId", "status");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_createdAt_idx" ON "Application"("createdAt");

-- CreateIndex
CREATE INDEX "Application_ref_idx" ON "Application"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_courseId_key" ON "Application"("userId", "courseId");

-- CreateIndex
CREATE INDEX "ApplicationStatusHistory_applicationId_idx" ON "ApplicationStatusHistory"("applicationId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_transactionRef_idx" ON "Payment"("transactionRef");

-- CreateIndex
CREATE INDEX "Payment_screenshotSha256_idx" ON "Payment"("screenshotSha256");

-- CreateIndex
CREATE INDEX "Payment_applicationId_idx" ON "Payment"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_applicationId_key" ON "Enrollment"("applicationId");

-- CreateIndex
CREATE INDEX "Enrollment_courseId_idx" ON "Enrollment"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_userId_courseId_key" ON "Enrollment"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_enrollmentId_key" ON "Certificate"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_serial_key" ON "Certificate"("serial");

-- CreateIndex
CREATE INDEX "SessionFeedback_courseId_sessionId_idx" ON "SessionFeedback"("courseId", "sessionId");

-- CreateIndex
CREATE INDEX "SessionFeedback_userId_idx" ON "SessionFeedback"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionFeedback_userId_sessionId_key" ON "SessionFeedback"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AdminNote_subjectUserId_idx" ON "AdminNote"("subjectUserId");

-- CreateIndex
CREATE INDEX "AdminNote_applicationId_idx" ON "AdminNote"("applicationId");

-- CreateIndex
CREATE INDEX "SavedFilter_ownerId_scope_idx" ON "SavedFilter"("ownerId", "scope");

-- CreateIndex
CREATE INDEX "FunnelEventLog_courseId_event_idx" ON "FunnelEventLog"("courseId", "event");

-- CreateIndex
CREATE INDEX "FunnelEventLog_createdAt_idx" ON "FunnelEventLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillRating" ADD CONSTRAINT "SkillRating_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningQuestion" ADD CONSTRAINT "ScreeningQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationStatusHistory" ADD CONSTRAINT "ApplicationStatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationStatusHistory" ADD CONSTRAINT "ApplicationStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSubmission" ADD CONSTRAINT "ProjectSubmission_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProgress" ADD CONSTRAINT "SessionProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProgress" ADD CONSTRAINT "SessionProgress_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFeedback" ADD CONSTRAINT "SessionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFeedback" ADD CONSTRAINT "SessionFeedback_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFeedback" ADD CONSTRAINT "SessionFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderPreference" ADD CONSTRAINT "ReminderPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderPreference" ADD CONSTRAINT "ReminderPreference_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEventLog" ADD CONSTRAINT "FunnelEventLog_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
