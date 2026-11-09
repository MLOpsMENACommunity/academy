import { z } from 'zod';
import type { TestimonialStatus } from './enums';

export const TESTIMONIAL_MIN = 20;
export const TESTIMONIAL_MAX = 600;

/** A student's testimonial. Publishing needs their explicit consent every time they save it. */
export const testimonialSchema = z.object({
  body: z.string().trim().min(TESTIMONIAL_MIN).max(TESTIMONIAL_MAX),
  consent: z.literal(true),
});
export type TestimonialInput = z.infer<typeof testimonialSchema>;

export const testimonialReviewSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']) });
export type TestimonialReviewInput = z.infer<typeof testimonialReviewSchema>;

/** The student's own testimonial, on the learn page. */
export interface MyTestimonialDto {
  body: string;
  status: TestimonialStatus;
}

/** An approved testimonial on the public course page: the name and the words, nothing else. */
export interface PublicTestimonialDto {
  id: string;
  name: string;
  nameAr: string | null;
  body: string;
}

/** Admin → Courses → course → Testimonials. */
export interface AdminTestimonialDto {
  id: string;
  name: string | null;
  email: string;
  body: string;
  status: TestimonialStatus;
  consentAt: string;
  updatedAt: string;
}
