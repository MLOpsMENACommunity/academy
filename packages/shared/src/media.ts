import { z } from 'zod';

/**
 * Images the team uploads (course and session covers, speaker photos). Stored in the private
 * bucket under media/, served publicly by the API at /api/media/<uuid>.<ext> with a year-long,
 * immutable cache: a new upload always gets a new random name. Videos stay YouTube/Drive links.
 */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_EXTENSIONS: Record<MediaType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** The file name part of a media URL: a random UUID and the type's extension. */
export const MEDIA_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
/** A media URL as stored in an image field. */
export const MEDIA_PATH_RE = /^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isMediaPath(v: string): boolean {
  return MEDIA_PATH_RE.test(v);
}

/** An image field: an http(s) URL, or an uploaded image (/api/media/…). Empty clears it. */
export const optionalImageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => isMediaPath(v) || (/^https?:\/\/[^\s]+$/i.test(v) && z.string().url().safeParse(v).success), 'Must be an http(s) URL or an uploaded image')
  .nullish()
  .or(z.literal('').transform(() => null));

/** A video or recording link: http(s) only. Empty clears it. */
const optionalLink = z
  .string()
  .trim()
  .url()
  .max(500)
  .regex(/^https?:\/\//i, 'Must be an http(s) URL')
  .nullish()
  .or(z.literal('').transform(() => null));

/**
 * Admin → Media (CONTENT): only image and video fields, never the rest of a course, session or
 * speaker. A field left out is kept; null or '' clears it. At least one field per request.
 */
const atLeastOne = (o: Record<string, unknown>) => Object.values(o).some((v) => v !== undefined);
export const mediaCourseSchema = z
  .object({ coverImageUrl: optionalImageUrlSchema, youtubePlaylistUrl: optionalLink })
  .strict()
  .refine(atLeastOne, 'Nothing to change');
export const mediaCourseSessionSchema = z.object({ recordingUrl: optionalLink }).strict().refine(atLeastOne, 'Nothing to change');
export const mediaEventSchema = z
  .object({ coverImageUrl: optionalImageUrlSchema, speakerPhotoUrl: optionalImageUrlSchema, recordingUrl: optionalLink })
  .strict()
  .refine(atLeastOne, 'Nothing to change');
export const mediaInstructorSchema = z.object({ photoUrl: optionalImageUrlSchema }).strict().refine(atLeastOne, 'Nothing to change');

export type MediaCourseInput = z.infer<typeof mediaCourseSchema>;
export type MediaCourseSessionInput = z.infer<typeof mediaCourseSessionSchema>;
export type MediaEventInput = z.infer<typeof mediaEventSchema>;
export type MediaInstructorInput = z.infer<typeof mediaInstructorSchema>;

/** What Admin → Media lists: names, dates and the media fields only. */
export interface MediaLibraryDto {
  courses: {
    id: string;
    slug: string;
    titleEn: string;
    titleAr: string;
    status: string;
    coverImageUrl: string | null;
    youtubePlaylistUrl: string | null;
    sessions: { id: string; order: number; titleEn: string; titleAr: string; startsAt: string; recordingUrl: string | null }[];
  }[];
  events: {
    id: string;
    slug: string;
    titleEn: string;
    titleAr: string;
    status: string;
    startsAt: string;
    speakerName: string;
    coverImageUrl: string | null;
    speakerPhotoUrl: string | null;
    recordingUrl: string | null;
  }[];
  speakers: { id: string; slug: string | null; name: string; nameAr: string | null; photoUrl: string | null }[];
}

export interface MediaUploadDto {
  url: string;
}
