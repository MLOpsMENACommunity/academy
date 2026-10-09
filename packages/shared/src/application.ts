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

/** Longest description accepted for an option that asks for details. */
export const ANSWER_DETAIL_MAX = 300;
export const ANSWER_DETAIL_MESSAGE = 'Describe your choice: this question is required';

/**
 * Answers key holding the description for an option that asks for details
 * (e.g. "My own domain (to be approved)"), next to the question's own answer.
 */
export const answerDetailKey = (questionId: string): string => `${questionId}:detail`;

/** The description given with a single-select answer, if its option asks for one. */
export function answerDetail(answers: Record<string, unknown>, q: Pick<QuestionLike, 'id' | 'options'>): string | null {
  if (typeof answers[q.id] !== 'string') return null;
  const chosen = (q.options ?? []).find((o) => o.value === answers[q.id]);
  const d = answers[answerDetailKey(q.id)];
  return chosen?.requiresDetail && typeof d === 'string' && d.trim() ? d.trim() : null;
}

/**
 * Builds the validator for one course's screening questions. Used by the web
 * form and by the API, so both accept exactly the same answers.
 */
export function buildAnswersSchema(questions: QuestionLike[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  /** Single-select questions with at least one option that asks for details. */
  const withDetail: { id: string; values: string[] }[] = [];
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
        // No z.coerce: it turns '', null, false and [] into 0, which would let a
        // required question be skipped with a fake answer. Blank means missing;
        // only real numbers or numeric strings are accepted.
        const base = z.preprocess(
          (v) => {
            if (v === undefined || v === null) return undefined;
            if (typeof v === 'string') {
              const t = v.trim();
              if (t === '') return undefined;
              return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : v;
            }
            return v;
          },
          q.required
            ? z.number({ required_error: 'This question is required', invalid_type_error: 'Enter a number' }).finite().min(-1e9).max(1e9)
            : z.number({ invalid_type_error: 'Enter a number' }).finite().min(-1e9).max(1e9).optional(),
        );
        s = base;
        break;
      }
      case 'YES_NO':
        s = q.required ? z.boolean({ required_error: 'This question is required' }) : z.boolean().optional();
        break;
      case 'SINGLE_SELECT': {
        const base = z.string().refine((v) => values.includes(v), 'Choose one of the options');
        s = q.required ? base : base.optional();
        const detailValues = (q.options ?? []).filter((o) => o.requiresDetail).map((o) => o.value);
        if (detailValues.length) {
          withDetail.push({ id: q.id, values: detailValues });
          shape[answerDetailKey(q.id)] = z.string().trim().max(ANSWER_DETAIL_MAX).optional();
        }
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
  return z
    .object(shape)
    .strip()
    .superRefine((a, ctx) => {
      for (const q of withDetail) {
        const key = answerDetailKey(q.id);
        if (q.values.includes(a[q.id] as string) && !a[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: ANSWER_DETAIL_MESSAGE });
        }
      }
    })
    .transform((a) => {
      // A description is only kept with the option that asked for it.
      const out: Record<string, unknown> = { ...a };
      for (const q of withDetail) {
        const key = answerDetailKey(q.id);
        if (!q.values.includes(a[q.id] as string) || !out[key]) delete out[key];
      }
      return out;
    });
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
