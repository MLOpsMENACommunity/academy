import { $Enums } from '@prisma/client';
import * as shared from '@academy/shared';

/** Prisma enum name -> tuple exported by @academy/shared. */
const pairs: Record<string, readonly string[]> = {
  Locale: shared.LOCALES,
  Role: shared.ROLES,
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
  CourseLanguage: shared.COURSE_LANGUAGES,
  DeliveryPlatform: shared.DELIVERY_PLATFORMS,
  RecordingsPlatform: shared.RECORDINGS_PLATFORMS,
  QuestionType: shared.QUESTION_TYPES,
  ApplicationStatus: shared.APPLICATION_STATUSES,
  PaymentMethod: shared.PAYMENT_METHODS,
  PaymentStatus: shared.PAYMENT_STATUSES,
  SavedFilterScope: shared.SAVED_FILTER_SCOPES,
  FunnelEvent: shared.FUNNEL_EVENTS,
  ReminderKind: shared.REMINDER_KINDS,
  DeliveryStatus: shared.DELIVERY_STATUSES,
  EventStatus: shared.EVENT_STATUSES,
  EventSpeakerRole: shared.EVENT_SPEAKER_ROLES,
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
