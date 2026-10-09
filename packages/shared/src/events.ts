import { z } from 'zod';
import { topicsSchema, type SpeakerRefDto } from './archive';
import {
  COURSE_LANGUAGES,
  DELIVERY_PLATFORMS,
  EVENT_SPEAKER_ROLES,
  EVENT_STATUSES,
  type CourseLanguage,
  type DeliveryPlatform,
  type EventSpeakerRole,
  type EventStatus,
} from './enums';

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
    speakerPhotoUrl: optionalUrl,
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
    startsAt: z.coerce.date(),
    durationMin: z.coerce.number().int().min(15).max(600),
    language: z.enum(COURSE_LANGUAGES),
    platform: z.enum(DELIVERY_PLATFORMS),
    liveUrl: optionalUrl,
    recordingUrl: optionalUrl,
    coverImageUrl: optionalUrl,
    capacity: z.coerce.number().int().min(1).max(100_000).nullish().or(z.literal('').transform(() => null)),
  })
  .superRefine((e, ctx) => {
    // Published sessions are public, so they need Arabic too (drafts can wait).
    if (e.status === 'PUBLISHED' && e.titleAr.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['titleAr'], message: 'Arabic title is required to publish' });
    }
    // Registered people would otherwise wait for a link that never comes. A session that
    // already took place (e.g. one added to the archive afterwards) doesn't need one.
    if (e.status === 'PUBLISHED' && !e.liveUrl && !eventEnded(e.startsAt, e.durationMin)) {
      ctx.addIssue({ code: 'custom', path: ['liveUrl'], message: 'A live link is required to publish' });
    }
  });
export type EventInput = z.infer<typeof eventInputSchema>;

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
  /** Only for the signed-in viewer. */
  me?: { registered: boolean; liveUrl: string | null; liveUrlFrom: string };
}

/** Ended = start + duration has passed. */
export function eventEnded(startsAt: Date, durationMin: number, now = new Date()): boolean {
  return now.getTime() > startsAt.getTime() + durationMin * 60_000;
}
