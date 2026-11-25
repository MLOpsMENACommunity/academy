import { z } from 'zod';
import type { CourseStatus, TestimonialStatus } from './enums';

export const TESTIMONIAL_MIN = 20;
export const TESTIMONIAL_MAX = 600;

/** Star ratings: 1 to 5 stars. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;
/** The average is public only once this many ratings are approved (fewer would say too little). */
export const RATING_MIN_TO_SHOW = 5;

/**
 * A student's review: stars, words, or both. The words are optional when there is a rating, but
 * if written they keep the testimonial limits. Publishing needs their explicit consent every time
 * they save it.
 */
export const testimonialSchema = z
  .object({
    body: z
      .string()
      .trim()
      .max(TESTIMONIAL_MAX)
      .default('')
      .refine((v) => v === '' || v.length >= TESTIMONIAL_MIN, { message: `At least ${TESTIMONIAL_MIN} characters` }),
    rating: z
      .number()
      .int()
      .min(RATING_MIN)
      .max(RATING_MAX)
      .nullish()
      .transform((v) => v ?? null),
    consent: z.literal(true),
  })
  .refine((v) => v.rating !== null || v.body !== '', { message: 'Choose a star rating or write a few words', path: ['rating'] });
export type TestimonialInput = z.infer<typeof testimonialSchema>;

export const testimonialReviewSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']) });
export type TestimonialReviewInput = z.infer<typeof testimonialReviewSchema>;

/** Admin → Reviews: one status at a time, the ones to review first. */
export const adminReviewsQuerySchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') });
export type AdminReviewsQuery = z.infer<typeof adminReviewsQuerySchema>;

/**
 * Who may rate and review a course: an enrolled student who has finished it. Finished means they
 * hold a valid certificate for it, or the course is over (COMPLETED, or its end date has passed).
 * A self-paced course has no end, so any enrolled student may review it (as before ratings).
 */
export function canReviewCourse(
  input: {
    enrolled: boolean;
    selfPaced: boolean;
    hasCertificate: boolean;
    status: CourseStatus;
    endDate: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  if (!input.enrolled) return false;
  if (input.selfPaced || input.hasCertificate) return true;
  if (input.status === 'COMPLETED') return true;
  return input.endDate !== null && new Date(input.endDate).getTime() < now.getTime();
}

/** A course's public rating: the average of its approved ratings. */
export interface CourseRatingDto {
  /** 1 decimal, e.g. 4.7. */
  average: number;
  count: number;
}

/** The public rating from the approved ratings' count and sum: null below RATING_MIN_TO_SHOW. */
export function courseRating(count: number, sum: number): CourseRatingDto | null {
  if (count < RATING_MIN_TO_SHOW || count <= 0) return null;
  return { average: Math.round((sum / count) * 10) / 10, count };
}

/** The student's own review, on the learn page. */
export interface MyTestimonialDto {
  body: string;
  rating: number | null;
  status: TestimonialStatus;
}

/** An approved review on the public course page: the name, the stars and the words, nothing else. */
export interface PublicTestimonialDto {
  id: string;
  name: string;
  nameAr: string | null;
  body: string;
  rating: number | null;
}

/** Admin → Courses → course → Testimonials. */
export interface AdminTestimonialDto {
  id: string;
  name: string | null;
  email: string;
  body: string;
  rating: number | null;
  status: TestimonialStatus;
  consentAt: string;
  updatedAt: string;
}

/** Admin → Reviews: every course's reviews in one queue. */
export interface AdminReviewDto extends AdminTestimonialDto {
  courseId: string;
  courseSlug: string;
  courseTitleEn: string;
  courseTitleAr: string;
}
