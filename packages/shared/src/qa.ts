import { z } from 'zod';

/**
 * Course Q&A: enrolled students ask questions in a course (optionally about one lesson or
 * session), anyone in the course answers, and the course staff with "Answer questions"
 * (ANSWER_QUESTIONS) moderate: pin, close and reopen, hide and unhide. The asker (or the staff)
 * accepts one answer; an accepted student answer earns QA_ANSWER_POINTS once.
 *
 * Nothing here removes anyone: hiding keeps the post (its author still sees it, marked hidden).
 */

/** Authors may edit their own question or answer for this long after posting. */
export const QA_EDIT_WINDOW_MIN = 30;
/** Points for a student whose answer is accepted (staff answers never earn points). */
export const QA_ANSWER_POINTS = 5;
/** Questions per page of the list. */
export const QA_PAGE_SIZE = 20;
export const QA_TITLE_MIN = 5;
export const QA_TITLE_MAX = 150;
export const QA_BODY_MAX = 5000;
export const QA_SEARCH_MAX = 100;

/** A question's state: text + CHECK constraint in the database, not a Postgres enum. */
export const QA_STATUSES = ['OPEN', 'ANSWERED', 'CLOSED'] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

/** The list's filter chips ("This lesson" is `sessionId`, combinable with any of them). */
export const QA_FILTERS = ['all', 'unanswered', 'mine', 'following'] as const;
export type QaFilter = (typeof QA_FILTERS)[number];

const id = z.string().trim().min(1).max(40);
const title = z.string().trim().min(QA_TITLE_MIN).max(QA_TITLE_MAX);
const body = z.string().trim().min(1).max(QA_BODY_MAX);

export const askQuestionSchema = z.object({
  title,
  body,
  /** The lesson or session it is about; empty or null for the whole course. */
  sessionId: id
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
});
export type AskQuestionInput = z.infer<typeof askQuestionSchema>;

/** Editing a question: title and body; `sessionId` only when sent (null moves it to the whole course). */
export const editQuestionSchema = z.object({
  title,
  body,
  sessionId: id
    .nullable()
    .or(z.literal(''))
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
});
export type EditQuestionInput = z.infer<typeof editQuestionSchema>;

export const answerSchema = z.object({ body });
export type AnswerInput = z.infer<typeof answerSchema>;
export const editAnswerSchema = answerSchema;
export type EditAnswerInput = AnswerInput;

export const qaListQuerySchema = z.object({
  filter: z.enum(QA_FILTERS).default('all'),
  sessionId: id.optional().or(z.literal('').transform(() => undefined)),
  q: z
    .string()
    .trim()
    .max(QA_SEARCH_MAX)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type QaListQuery = z.infer<typeof qaListQuerySchema>;

/** Accept an answer (null: un-accept). */
export const acceptAnswerSchema = z.object({ answerId: id.nullable() });
export type AcceptAnswerInput = z.infer<typeof acceptAnswerSchema>;

export const qaPinSchema = z.object({ pinned: z.boolean() });
export const qaCloseSchema = z.object({ closed: z.boolean() });
export const qaHideSchema = z.object({ hidden: z.boolean() });

// ------------------------------------------------------------------ rules

/** The moment the author can no longer edit a post. */
export function editableUntil(createdAt: Date | string): Date {
  return new Date(new Date(createdAt).getTime() + QA_EDIT_WINDOW_MIN * 60_000);
}

/** The author may still edit a post created at `createdAt` (within QA_EDIT_WINDOW_MIN). */
export function canEditPost(createdAt: Date | string, now: Date = new Date()): boolean {
  return now.getTime() <= editableUntil(createdAt).getTime();
}

/** A question with a visible answer is ANSWERED, without one OPEN; CLOSED stays closed until reopened. */
export function nextQaStatus(current: QaStatus, hasVisibleAnswer: boolean): QaStatus {
  if (current === 'CLOSED') return 'CLOSED';
  return hasVisibleAnswer ? 'ANSWERED' : 'OPEN';
}

/**
 * A short plain-text excerpt of a markdown body (emails, notifications): code blocks become
 * "[code]", markdown marks and links' targets are dropped, whitespace collapsed, cut at a word.
 */
export function qaExcerpt(markdown: string, max = 200): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ------------------------------------------------------------------ what the API returns

/**
 * Who wrote a post. Students are shown by first name + last initial; `name` is null for a deleted
 * account (the page shows "Former student"). Staff answers carry their course role's name, or
 * none for an anonymous role or an admin outside the staff (the page shows "Course team"). Never an email.
 */
export interface QaAuthorDto {
  name: string | null;
  isStaff: boolean;
  roleLabel: string | null;
  roleLabelAr: string | null;
  isYou: boolean;
}

export interface QaSessionRefDto {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
}

export interface QuestionSummaryDto {
  id: string;
  title: string;
  session: QaSessionRefDto | null;
  author: QaAuthorDto;
  status: QaStatus;
  pinned: boolean;
  /** Hidden by the staff: only its author (and the staff) see it. */
  hidden: boolean;
  voteCount: number;
  /** Visible answers. */
  answerCount: number;
  /** The viewer said "I have this question too". */
  voted: boolean;
  following: boolean;
  hasAccepted: boolean;
  lastActivityAt: string;
  createdAt: string;
}

export interface QaListDto {
  items: QuestionSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
  /** The viewer may pin, close and hide (course staff with ANSWER_QUESTIONS, SUPER/ACADEMIC admins). */
  canModerate: boolean;
}

export interface AnswerDto {
  id: string;
  body: string;
  author: QaAuthorDto;
  hidden: boolean;
  accepted: boolean;
  edited: boolean;
  /** Set while the viewer (its author) may still edit it. */
  editableUntil: string | null;
  createdAt: string;
}

export interface QuestionDetailDto extends QuestionSummaryDto {
  body: string;
  edited: boolean;
  /** Set while the viewer (its author) may still edit it. */
  editableUntil: string | null;
  acceptedAnswerId: string | null;
  /** The viewer may accept an answer (the asker, or a moderator). */
  canAccept: boolean;
  canModerate: boolean;
  /** Accepted first, then oldest first. */
  answers: AnswerDto[];
}
