import { $Enums } from '@prisma/client';
import * as shared from '@academy/shared';

/** Prisma enum name -> tuple exported by @academy/shared. */
const pairs: Record<string, readonly string[]> = {
  Locale: shared.LOCALES,
  Role: shared.ROLES,
  AdminPermission: shared.ADMIN_PERMISSIONS,
  SpeakerArea: shared.SPEAKER_AREAS,
  SpeakerFormat: shared.SPEAKER_FORMATS,
  SpeakerKind: shared.SPEAKER_KINDS,
  SpeakerReferralSource: shared.SPEAKER_REFERRAL_SOURCES,
  SpeakerApplicationStatus: shared.SPEAKER_APPLICATION_STATUSES,
  SlotStatus: shared.SLOT_STATUSES,
  EmploymentStatus: shared.EMPLOYMENT_STATUSES,
  ExperienceRange: shared.EXPERIENCE_RANGES,
  Area: shared.AREAS,
  Industry: shared.INDUSTRIES,
  CompanySize: shared.COMPANY_SIZES,
  Seniority: shared.SENIORITIES,
  EducationLevel: shared.EDUCATION_LEVELS,
  Skill: shared.SKILLS,
  CloudPlatform: shared.CLOUD_PLATFORMS,
  LearningGoal: shared.LEARNING_GOALS,
  Topic: shared.TOPICS,
  WeeklyHours: shared.WEEKLY_HOURS,
  SessionTime: shared.SESSION_TIMES,
  LearningFormat: shared.LEARNING_FORMATS,
  ReferralSource: shared.REFERRAL_SOURCES,
  CourseType: shared.COURSE_TYPES,
  CourseStatus: shared.COURSE_STATUSES,
  CourseLevel: shared.COURSE_LEVELS,
  AudienceLevel: shared.AUDIENCE_LEVELS,
  CourseLanguage: shared.COURSE_LANGUAGES,
  DeliveryPlatform: shared.DELIVERY_PLATFORMS,
  RecordingsPlatform: shared.RECORDINGS_PLATFORMS,
  QuestionType: shared.QUESTION_TYPES,
  ApplicationStatus: shared.APPLICATION_STATUSES,
  CourseInviteStatus: shared.COURSE_INVITE_STATUSES,
  PaymentMethod: shared.PAYMENT_METHODS,
  PaymentStatus: shared.PAYMENT_STATUSES,
  SavedFilterScope: shared.SAVED_FILTER_SCOPES,
  FunnelEvent: shared.FUNNEL_EVENTS,
  ReminderKind: shared.REMINDER_KINDS,
  DeliveryStatus: shared.DELIVERY_STATUSES,
  EventStatus: shared.EVENT_STATUSES,
  EventSpeakerRole: shared.EVENT_SPEAKER_ROLES,
  EventCategory: shared.EVENT_CATEGORIES,
  // Assessments
  AssessmentType: shared.ASSESSMENT_TYPES,
  AssessmentStatus: shared.ASSESSMENT_STATUSES,
  SubmissionKind: shared.SUBMISSION_KINDS,
  ScoringPolicy: shared.SCORING_POLICIES,
  RevealPolicy: shared.REVEAL_POLICIES,
  QuizQuestionKind: shared.QUIZ_QUESTION_KINDS,
  RepoCheck: shared.REPO_CHECKS,
  // Points and badges
  PointsReason: shared.POINTS_REASONS,
  BadgeKind: shared.BADGE_KINDS,
};

describe('Prisma enums match @academy/shared', () => {
  it('covers every Prisma enum', () => {
    expect(Object.keys($Enums).sort()).toEqual(Object.keys(pairs).sort());
  });

  it.each(Object.entries(pairs))('%s has the same values in the same order', (name, values) => {
    expect(Object.values(($Enums as Record<string, Record<string, string>>)[name]!)).toEqual([
      ...values,
    ]);
  });
});
