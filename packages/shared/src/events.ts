import { z } from 'zod';
import { topicsSchema, type SpeakerRefDto } from './archive';
import {
  COURSE_LANGUAGES,
  DELIVERY_PLATFORMS,
  EVENT_CATEGORIES,
  EVENT_SPEAKER_ROLES,
  EVENT_STATUSES,
  type CourseLanguage,
  type DeliveryPlatform,
  type EventCategory,
  type EventSpeakerRole,
  type EventStatus,
} from './enums';
import { optionalImageUrlSchema } from './media';
import { eventDetailsInputSchema, type SpeakerDetailsDto, type SpeakerKind } from './speaker-details';

/** Links people click: http(s) only. */
const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .regex(/^https?:\/\//i, 'Must be an http(s) URL')
  .nullish()
  .or(z.literal('').transform(() => null));

/** Paths under /sessions that are pages of their own, so no session can use them as a slug. */
export const RESERVED_EVENT_SLUGS = ['recordings'] as const;

/** Admin input for a free live session (talk, workshop, AMA). */
export const eventInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes only')
      .max(80)
      .refine((s) => !(RESERVED_EVENT_SLUGS as readonly string[]).includes(s), 'This slug is reserved'),
    status: z.enum(EVENT_STATUSES),
    titleEn: z.string().trim().min(2).max(160),
    titleAr: z.string().trim().max(160).default(''),
    descriptionEn: z.string().trim().max(20_000).default(''),
    descriptionAr: z.string().trim().max(20_000).default(''),
    speakerName: z.string().trim().max(120).default(''),
    speakerNameAr: z.string().trim().max(120).default(''),
    speakerTitleEn: z.string().trim().max(160).default(''),
    speakerTitleAr: z.string().trim().max(160).default(''),
    speakerPhotoUrl: optionalImageUrlSchema,
    speakerLinkedinUrl: optionalUrl,
    /** The speaker's profile (an instructor), for the link to /speakers/{slug}. */
    speakerId: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .or(z.literal('').transform(() => null)),
    /**
     * Hosts and guests besides the main speaker, in order. Left out: kept as they are
     * (so a client that doesn't know about them never clears them).
     */
    coSpeakers: z
      .array(
        z.object({
          instructorId: z.string().trim().min(1).max(40),
          role: z.enum(EVENT_SPEAKER_ROLES),
        }),
      )
      .max(10)
      .refine(
        (list) => new Set(list.map((x) => x.instructorId)).size === list.length,
        'Each person can be listed once',
      )
      .optional(),
    topics: topicsSchema.default([]),
    /**
     * Its shelf in the recordings library (hands-on, from industry, …); null: none.
     * Left out: kept as it is (so a client that doesn't know about it never clears it).
     */
    category: z
      .enum(EVENT_CATEGORIES)
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    startsAt: z.coerce.date(),
    durationMin: z.coerce.number().int().min(15).max(600),
    language: z.enum(COURSE_LANGUAGES),
    platform: z.enum(DELIVERY_PLATFORMS),
    liveUrl: optionalUrl,
    recordingUrl: optionalUrl,
    coverImageUrl: optionalImageUrlSchema,
    capacity: z.coerce.number().int().min(1).max(100_000).nullish().or(z.literal('').transform(() => null)),
    /**
     * Session, course or podcast, and its optional details (filled by the speaker when booking,
     * or by the team). Left out: kept as they are.
     */
    details: eventDetailsInputSchema.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.status !== 'PUBLISHED') return;
    for (const field of eventPublishMissing(e)) {
      ctx.addIssue({ code: 'custom', path: [field], message: EVENT_PUBLISH_MESSAGES[field] });
    }
  });
export type EventInput = z.infer<typeof eventInputSchema>;

/** What a session needs before it can be published, besides what every save needs. */
export type EventPublishField = 'titleAr' | 'liveUrl';

export const EVENT_PUBLISH_MESSAGES: Record<EventPublishField, string> = {
  titleAr: 'Arabic title is required to publish',
  liveUrl: 'A live link is required to publish',
};

/**
 * What is missing to publish a session: the server's check (eventInputSchema) and the admin's
 * "Publish" button use this one list.
 *   - An Arabic title: published sessions are public, so they need Arabic too (drafts can wait).
 *   - The live (Meet) link: registered people would otherwise wait for a link that never comes.
 *     A session that already took place (e.g. one added to the archive afterwards) doesn't need one.
 */
export function eventPublishMissing(
  e: { titleAr?: string | null; liveUrl?: string | null; startsAt?: Date | string | null; durationMin?: number | null },
  now = new Date(),
): EventPublishField[] {
  const missing: EventPublishField[] = [];
  if ((e.titleAr ?? '').trim().length < 2) missing.push('titleAr');
  const startsAt = e.startsAt ? new Date(e.startsAt) : null;
  const ended = startsAt !== null && !Number.isNaN(startsAt.getTime()) && eventEnded(startsAt, e.durationMin ?? 0, now);
  if (!(e.liveUrl ?? '').trim() && !ended) missing.push('liveUrl');
  return missing;
}

/** A host or guest of a session, besides its main speaker. */
export interface CoSpeakerDto extends SpeakerRefDto {
  role: EventSpeakerRole;
}

/** A live session as the public sees it. The live link is only included for registered people near the start. */
export interface PublicEventDto {
  slug: string;
  status: EventStatus;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  speakerName: string;
  speakerNameAr: string;
  speakerTitleEn: string;
  speakerTitleAr: string;
  speakerPhotoUrl: string | null;
  speakerLinkedinUrl: string | null;
  /** The speaker's profile, when the session is linked to one (name and title above win when set). */
  speaker: SpeakerRefDto | null;
  /** Hosts and guests besides the main speaker, in order. */
  coSpeakers: CoSpeakerDto[];
  topics: string[];
  category: EventCategory | null;
  startsAt: string;
  durationMin: number;
  language: CourseLanguage;
  platform: DeliveryPlatform;
  coverImageUrl: string | null;
  /** Only once the session has ended (admins often paste the live URL here ahead of time). */
  recordingUrl: string | null;
  /** True once the session has ended. */
  past: boolean;
  capacity: number | null;
  registered: number;
  full: boolean;
  /** Session, course or podcast, and the details that are filled in (empty ones are left out). */
  kind: SpeakerKind;
  details: SpeakerDetailsDto;
  /** Only for the signed-in viewer. */
  me?: { registered: boolean; liveUrl: string | null; liveUrlFrom: string };
}

/** Ended = start + duration has passed. */
export function eventEnded(startsAt: Date, durationMin: number, now = new Date()): boolean {
  return now.getTime() > startsAt.getTime() + durationMin * 60_000;
}
