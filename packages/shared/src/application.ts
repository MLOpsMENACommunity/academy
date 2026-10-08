import { z } from 'zod';
import { ADMIN_APPLICATION_EVENTS } from './state-machine';
import type { ApplicationStatus, CourseType, QuestionType } from './enums';
import type { QuestionOption } from './course-content';
import type { SourceParams } from './urls';

export interface QuestionLike {
  id: string;
  type: QuestionType;
  required: boolean;
  options: QuestionOption[] | null;
}

export type AnswerValue = string | string[] | number | boolean;
export type Answers = Record<string, AnswerValue>;

const MAX_TEXT = { SHORT_TEXT: 300, LONG_TEXT: 4000 } as const;

/**
 * Builds the validator for one course's screening questions. Used by the web
 * form and by the API, so both accept exactly the same answers.
 */
export function buildAnswersSchema(questions: QuestionLike[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of questions) {
    const values = (q.options ?? []).map((o) => o.value);
    let s: z.ZodTypeAny;
    switch (q.type) {
      case 'SHORT_TEXT':
      case 'LONG_TEXT': {
        const base = z.string().trim().max(MAX_TEXT[q.type]);
        s = q.required ? base.min(1, 'This question is required') : base.optional();
        break;
      }
      case 'NUMBER': {
        const base = z.coerce.number({ invalid_type_error: 'Enter a number' }).finite().min(-1e9).max(1e9);
        s = q.required ? base : z.union([base, z.literal('').transform(() => undefined)]).optional();
        break;
      }
      case 'YES_NO':
        s = q.required ? z.boolean({ required_error: 'This question is required' }) : z.boolean().optional();
        break;
      case 'SINGLE_SELECT': {
        const base = z.string().refine((v) => values.includes(v), 'Choose one of the options');
        s = q.required ? base : base.optional();
        break;
      }
      case 'MULTI_SELECT': {
        const base = z
          .array(z.string().refine((v) => values.includes(v), 'Invalid option'))
          .max(values.length)
          .transform((a) => Array.from(new Set(a)));
        s = q.required ? base.refine((a) => a.length > 0, 'Choose at least one option') : base.optional();
        break;
      }
    }
    shape[q.id] = s;
  }
  // Unknown keys are dropped: only answers to this course's questions are stored.
  return z.object(shape).strip();
}

export const applySchema = z.object({
  courseSlug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  answers: z.record(z.unknown()),
  source: z.record(z.string().max(100)).optional(),
});
export type ApplyInput = z.infer<typeof applySchema>;

export const adminTransitionSchema = z.object({
  event: z.enum(ADMIN_APPLICATION_EVENTS),
  reason: z.string().trim().max(1000).optional(),
});
export type AdminTransitionInput = z.infer<typeof adminTransitionSchema>;

export interface ApplicationHistoryDto {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  reason: string | null;
  createdAt: string;
}

export interface MyApplicationDto {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  rejectionReason: string | null;
  enrolled: boolean;
  course: {
    slug: string;
    titleEn: string;
    titleAr: string;
    type: CourseType;
    price: number;
    currency: string;
    startDate: string | null;
  };
  history: ApplicationHistoryDto[];
}

export interface MyApplicationDetailDto extends MyApplicationDto {
  answers: Answers;
  source: SourceParams;
  questions: { id: string; labelEn: string; labelAr: string; type: QuestionType; options: QuestionOption[] | null }[];
}
