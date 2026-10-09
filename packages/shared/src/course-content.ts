import { z } from 'zod';

/** Shapes of the JSON columns on Course / CourseSession / ScreeningQuestion. */

export const localizedTextSchema = z.object({ en: z.string(), ar: z.string() });
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const localizedListSchema = z.object({ en: z.array(z.string()), ar: z.array(z.string()) });
export type LocalizedList = z.infer<typeof localizedListSchema>;

export const outlineModuleSchema = z.object({
  titleEn: z.string().min(1),
  titleAr: z.string().min(1),
  descriptionEn: z.string().optional(),
  descriptionAr: z.string().optional(),
});
export type OutlineModule = z.infer<typeof outlineModuleSchema>;

export const faqItemSchema = z.object({
  questionEn: z.string().min(1),
  questionAr: z.string().min(1),
  answerEn: z.string().min(1),
  answerAr: z.string().min(1),
});
export type FaqItem = z.infer<typeof faqItemSchema>;

export const includedSchema = z.object({
  liveSessions: z.boolean(),
  recordings: z.boolean(),
  assignments: z.boolean(),
  finalProject: z.boolean(),
  certificate: z.boolean(),
  notesEn: z.string().optional(),
  notesAr: z.string().optional(),
});
export type Included = z.infer<typeof includedSchema>;

export const questionOptionSchema = z.object({
  value: z.string().min(1).max(64),
  labelEn: z.string().min(1),
  labelAr: z.string().min(1),
  /** Picking this option asks for a required short description (e.g. "My own domain"). */
  requiresDetail: z.boolean().optional(),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const materialSchema = z.object({
  labelEn: z.string().min(1),
  labelAr: z.string().min(1),
  url: z.string().url().regex(/^https?:\/\//i, 'Must be an http(s) URL'),
});
export type Material = z.infer<typeof materialSchema>;
