import { defineEnum } from './enum';

// Every enum here has an identically named enum in apps/api/prisma/schema.prisma.

export const LOCALES = ['en', 'ar'] as const;
export const Locale = defineEnum(LOCALES);
export type Locale = (typeof LOCALES)[number];

/**
 * One account, one role. SPEAKER accounts use the speaker portal (apply, book a slot) and
 * never apply to courses; an admin can switch a STUDENT and a SPEAKER account either way.
 */
export const ROLES = ['STUDENT', 'ADMIN', 'SPEAKER'] as const;
export const Role = defineEnum(ROLES);
export type Role = (typeof ROLES)[number];

/**
 * What an ADMIN account may do (presets; an admin has one or more). SUPER can do everything,
 * including managing the team, settings and the audit log. See admin-permissions.ts.
 */
export const ADMIN_PERMISSIONS = ['SUPER', 'ACADEMIC', 'CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'] as const;
export const AdminPermission = defineEnum(ADMIN_PERMISSIONS);
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

// ---------------------------------------------------------------- Profile

export const EMPLOYMENT_STATUSES = [
  'EMPLOYED_FULL_TIME',
  'EMPLOYED_PART_TIME',
  'FREELANCER',
  'STUDENT',
  'JOB_SEEKING',
  'OTHER',
] as const;
export const EmploymentStatus = defineEnum(EMPLOYMENT_STATUSES);
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/** Ordered: index is used for "at least N years" filters. */
export const EXPERIENCE_RANGES = ['Y0_1', 'Y1_3', 'Y3_5', 'Y5_10', 'Y10_PLUS'] as const;
export const ExperienceRange = defineEnum(EXPERIENCE_RANGES);
export type ExperienceRange = (typeof EXPERIENCE_RANGES)[number];

export const AREAS = [
  'ML_ENGINEERING',
  'MLOPS',
  'LLMOPS_AI_ENGINEERING',
  'DATA_SCIENCE',
  'DATA_ENGINEERING',
  'SOFTWARE_BACKEND',
  'DEVOPS_PLATFORM_SRE',
  'RESEARCH',
  'STUDENT',
  'OTHER',
] as const;
export const Area = defineEnum(AREAS);
export type Area = (typeof AREAS)[number];

export const INDUSTRIES = [
  'FINTECH',
  'TELECOM',
  'HEALTHCARE',
  'ECOMMERCE',
  'GOVERNMENT',
  'CONSULTING',
  'ACADEMIA',
  'OTHER',
] as const;
export const Industry = defineEnum(INDUSTRIES);
export type Industry = (typeof INDUSTRIES)[number];

export const COMPANY_SIZES = ['S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS'] as const;
export const CompanySize = defineEnum(COMPANY_SIZES);
export type CompanySize = (typeof COMPANY_SIZES)[number];

/** Ordered from most junior to most senior. */
export const SENIORITIES = [
  'INTERN',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD_STAFF',
  'MANAGER',
  'HEAD_DIRECTOR',
] as const;
export const Seniority = defineEnum(SENIORITIES);
export type Seniority = (typeof SENIORITIES)[number];

export const EDUCATION_LEVELS = [
  'HIGH_SCHOOL',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'PHD',
  'BOOTCAMP_SELF_TAUGHT',
] as const;
export const EducationLevel = defineEnum(EDUCATION_LEVELS);
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const SKILLS = [
  'PYTHON',
  'SQL',
  'LINUX_BASH',
  'GIT',
  'DOCKER',
  'KUBERNETES',
  'CI_CD',
  'AWS',
  'GCP',
  'AZURE',
  'ML_FUNDAMENTALS',
  'DEEP_LEARNING',
  'LLMS_RAG',
  'AGENTS',
  'MLOPS_TOOLING',
  'MONITORING_OBSERVABILITY',
] as const;
export const Skill = defineEnum(SKILLS);
export type Skill = (typeof SKILLS)[number];

export const CLOUD_PLATFORMS = ['AWS', 'GCP', 'AZURE', 'ORACLE', 'ALIBABA', 'OTHER'] as const;
export const CloudPlatform = defineEnum(CLOUD_PLATFORMS);
export type CloudPlatform = (typeof CLOUD_PLATFORMS)[number];

export const LEARNING_GOALS = [
  'FIRST_ML_JOB',
  'MOVE_TO_MLOPS',
  'LEVEL_UP_SENIOR',
  'LEAD_TEAM',
  'BUILD_PRODUCT',
  'FREELANCING',
  'RESEARCH',
] as const;
export const LearningGoal = defineEnum(LEARNING_GOALS);
export type LearningGoal = (typeof LEARNING_GOALS)[number];

export const TOPICS = [
  'MLOPS',
  'LLMOPS',
  'KUBERNETES',
  'RAG',
  'AGENTS',
  'AI_ARCHITECTURE',
  'CLOUD',
  'DATA_ENGINEERING',
  'COMPUTER_VISION',
  'NLP',
  'DEEP_LEARNING',
  'MONITORING',
  'SECURITY_GOVERNANCE',
] as const;
export const Topic = defineEnum(TOPICS);
export type Topic = (typeof TOPICS)[number];

/** Ordered: index is used for "at least N hours" filters. */
export const WEEKLY_HOURS = ['H_LT_2', 'H_2_5', 'H_5_10', 'H_10_PLUS'] as const;
export const WeeklyHours = defineEnum(WEEKLY_HOURS);
export type WeeklyHours = (typeof WEEKLY_HOURS)[number];

export const SESSION_TIMES = [
  'WEEKDAY_MORNINGS',
  'WEEKDAY_EVENINGS',
  'WEEKEND_MORNINGS',
  'WEEKEND_EVENINGS',
] as const;
export const SessionTime = defineEnum(SESSION_TIMES);
export type SessionTime = (typeof SESSION_TIMES)[number];

export const LEARNING_FORMATS = ['LIVE', 'RECORDED', 'HYBRID'] as const;
export const LearningFormat = defineEnum(LEARNING_FORMATS);
export type LearningFormat = (typeof LEARNING_FORMATS)[number];

export const REFERRAL_SOURCES = [
  'MAIN_SITE',
  'LINKEDIN',
  'FACEBOOK',
  'X_TWITTER',
  'YOUTUBE',
  'DISCORD',
  'TELEGRAM',
  'WHATSAPP',
  'FRIEND_COLLEAGUE',
  'EVENT',
  'SEARCH',
  'OTHER',
] as const;
export const ReferralSource = defineEnum(REFERRAL_SOURCES);
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

// ---------------------------------------------------------------- Courses

export const COURSE_TYPES = ['FREE', 'PAID'] as const;
export const CourseType = defineEnum(COURSE_TYPES);
export type CourseType = (typeof COURSE_TYPES)[number];

/**
 * COMING_SOON: listed publicly as "Opening soon", no applications, no dates needed.
 * COMPLETED: a past cohort that stays public (syllabus, recordings, instructors), no applications.
 */
export const COURSE_STATUSES = ['DRAFT', 'COMING_SOON', 'OPEN', 'CLOSED', 'ARCHIVED', 'COMPLETED'] as const;
export const CourseStatus = defineEnum(COURSE_STATUSES);
export type CourseStatus = (typeof COURSE_STATUSES)[number];
/** Statuses visible on the public catalog and course pages. */
export const PUBLIC_COURSE_STATUSES = ['COMING_SOON', 'OPEN', 'CLOSED', 'COMPLETED'] as const satisfies readonly CourseStatus[];

/**
 * The single level courses had before `levels` (kept for API compatibility; derived from
 * `levels` on every save, see legacyCourseLevel).
 */
export const COURSE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS'] as const;
export const CourseLevel = defineEnum(COURSE_LEVELS);
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/** Who a course is for, by career level, in order. A course targets one or more; none means all levels. */
export const AUDIENCE_LEVELS = ['JUNIOR', 'MID', 'SENIOR', 'LEAD'] as const;
export const AudienceLevel = defineEnum(AUDIENCE_LEVELS);
export type AudienceLevel = (typeof AUDIENCE_LEVELS)[number];

export const COURSE_LANGUAGES = ['EN', 'AR', 'BILINGUAL'] as const;
export const CourseLanguage = defineEnum(COURSE_LANGUAGES);
export type CourseLanguage = (typeof COURSE_LANGUAGES)[number];

export const DELIVERY_PLATFORMS = ['GOOGLE_MEET', 'YOUTUBE_LIVE'] as const;
export const DeliveryPlatform = defineEnum(DELIVERY_PLATFORMS);
export type DeliveryPlatform = (typeof DELIVERY_PLATFORMS)[number];

export const RECORDINGS_PLATFORMS = ['YOUTUBE', 'GOOGLE_DRIVE'] as const;
export const RecordingsPlatform = defineEnum(RECORDINGS_PLATFORMS);
export type RecordingsPlatform = (typeof RECORDINGS_PLATFORMS)[number];

/** Derived for the catalog filter; not stored. */
export const COURSE_AVAILABILITIES = ['OPEN', 'UPCOMING', 'CLOSED'] as const;
export const CourseAvailability = defineEnum(COURSE_AVAILABILITIES);
export type CourseAvailability = (typeof COURSE_AVAILABILITIES)[number];

export const QUESTION_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'YES_NO',
  'NUMBER',
] as const;
export const QuestionType = defineEnum(QUESTION_TYPES);
export type QuestionType = (typeof QUESTION_TYPES)[number];

// ---------------------------------------------------------------- Applications & payments

export const APPLICATION_STATUSES = [
  'SUBMITTED',
  'SHORTLISTED',
  'AWAITING_PAYMENT',
  'PAYMENT_SUBMITTED',
  'PAYMENT_REJECTED',
  'ENROLLED',
  'REJECTED',
  'WAITLISTED',
] as const;
export const ApplicationStatus = defineEnum(APPLICATION_STATUSES);
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const PAYMENT_METHODS = ['INSTAPAY', 'VODAFONE_CASH', 'CARD'] as const;
export const PaymentMethod = defineEnum(PAYMENT_METHODS);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Card is modelled for later (Paymob) but not offered in v1. */
export const MANUAL_PAYMENT_METHODS = ['INSTAPAY', 'VODAFONE_CASH'] as const;

export const PAYMENT_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
export const PaymentStatus = defineEnum(PAYMENT_STATUSES);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** "Enrol by email" invites (see invites.ts). */
export const COURSE_INVITE_STATUSES = ['PENDING', 'ENROLLED', 'REVOKED'] as const;
export const CourseInviteStatus = defineEnum(COURSE_INVITE_STATUSES);
export type CourseInviteStatus = (typeof COURSE_INVITE_STATUSES)[number];

// ---------------------------------------------------------------- Misc

export const SAVED_FILTER_SCOPES = ['APPLICATIONS', 'STUDENTS'] as const;
export const SavedFilterScope = defineEnum(SAVED_FILTER_SCOPES);
export type SavedFilterScope = (typeof SAVED_FILTER_SCOPES)[number];

export const FUNNEL_EVENTS = [
  'COURSE_VIEW',
  'APPLY_CLICKED',
  'REGISTERED',
  'PROFILE_COMPLETED',
  'APPLICATION_SUBMITTED',
  'SHORTLISTED',
  'PAYMENT_SUBMITTED',
  'ENROLLED',
] as const;
export const FunnelEvent = defineEnum(FUNNEL_EVENTS);
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export const REMINDER_KINDS = ['H24', 'H1'] as const;
export const ReminderKind = defineEnum(REMINDER_KINDS);
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export function isLocaleValue(v: unknown): v is Locale {
  return v === 'en' || v === 'ar';
}

// ---------------------------------------------------------------- Announcements

/** Email delivery state of one announcement recipient. */
export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export const DeliveryStatus = defineEnum(DELIVERY_STATUSES);
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// ---------------------------------------------------------------- Live sessions

export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;
export const EventStatus = defineEnum(EVENT_STATUSES);
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** What a person did at a session besides its main speaker. */
export const EVENT_SPEAKER_ROLES = ['SPEAKER', 'HOST', 'GUEST'] as const;
export const EventSpeakerRole = defineEnum(EVENT_SPEAKER_ROLES);
export type EventSpeakerRole = (typeof EVENT_SPEAKER_ROLES)[number];

/**
 * The kind of a recording in the library. Course lessons are always COURSE_RECORDING;
 * a live session's category is set on the session (none: shown under "All" only).
 */
export const EVENT_CATEGORIES = ['HANDS_ON', 'INDUSTRY', 'COURSE_RECORDING', 'TALK'] as const;
export const EventCategory = defineEnum(EVENT_CATEGORIES);
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// ---------------------------------------------------------------- Assessments

export const ASSESSMENT_TYPES = ['QUIZ', 'LAB', 'ASSIGNMENT'] as const;
export const AssessmentType = defineEnum(ASSESSMENT_TYPES);
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const ASSESSMENT_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export const AssessmentStatus = defineEnum(ASSESSMENT_STATUSES);
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const SUBMISSION_KINDS = ['GITHUB_REPO', 'DRIVE_LINK', 'PDF', 'LINK'] as const;
export const SubmissionKind = defineEnum(SUBMISSION_KINDS);
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const SCORING_POLICIES = ['BEST', 'LAST'] as const;
export const ScoringPolicy = defineEnum(SCORING_POLICIES);
export type ScoringPolicy = (typeof SCORING_POLICIES)[number];

export const REVEAL_POLICIES = ['NEVER', 'AFTER_SUBMIT', 'AFTER_DUE'] as const;
export const RevealPolicy = defineEnum(REVEAL_POLICIES);
export type RevealPolicy = (typeof REVEAL_POLICIES)[number];

export const QUIZ_QUESTION_KINDS = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE'] as const;
export const QuizQuestionKind = defineEnum(QUIZ_QUESTION_KINDS);
export type QuizQuestionKind = (typeof QUIZ_QUESTION_KINDS)[number];

export const REPO_CHECKS = ['PUBLIC', 'NOT_PUBLIC', 'UNVERIFIED'] as const;
export const RepoCheck = defineEnum(REPO_CHECKS);
export type RepoCheck = (typeof REPO_CHECKS)[number];

// ---------------------------------------------------------------- Points and badges

export const POINTS_REASONS = ['ASSESSMENT', 'SESSION_COMPLETED', 'CERTIFICATE', 'MANUAL_COMMUNITY', 'MANUAL_OTHER', 'ADJUSTMENT', 'ATTENDANCE'] as const;
export const PointsReason = defineEnum(POINTS_REASONS);
export type PointsReason = (typeof POINTS_REASONS)[number];

// ---------------------------------------------------------------- Attendance

export const ATTENDANCE_STATUSES = ['PRESENT', 'PARTIAL', 'ABSENT'] as const;
export const AttendanceStatus = defineEnum(ATTENDANCE_STATUSES);
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** CSV: from an uploaded Meet attendance file; MANUAL: set by hand afterwards. */
export const ATTENDANCE_SOURCES = ['CSV', 'MANUAL'] as const;
export const AttendanceSource = defineEnum(ATTENDANCE_SOURCES);
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const BADGE_KINDS = ['AUTO', 'MANUAL'] as const;
export const BadgeKind = defineEnum(BADGE_KINDS);
export type BadgeKind = (typeof BADGE_KINDS)[number];
