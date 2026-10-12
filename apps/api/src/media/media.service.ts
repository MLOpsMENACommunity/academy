import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MEDIA_MAX_BYTES,
  MEDIA_NAME_RE,
  type MediaCourseInput,
  type MediaCourseSessionInput,
  type MediaEventInput,
  type MediaInstructorInput,
  type MediaLibraryDto,
  type MediaUploadDto,
} from '@academy/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectImageType } from '../storage/file-type';
import { StorageService } from '../storage/storage.service';

export const MEDIA_PREFIX = 'media';
const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** The fields a request actually sets (left out: kept). */
function changes<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Uploaded images and the media fields of courses, course sessions, live sessions and speakers
 * (Admin → Media). Nothing here reads or returns personal data, and nothing changes any other
 * field: the full editors stay with the academic and speakers presets.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** JPG, PNG or WebP (checked from the bytes), at most 5 MB. Stored under a new random name. */
  async upload(file: Express.Multer.File | undefined, actorId: string): Promise<MediaUploadDto> {
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose an image to upload' });
    if (file.size > MEDIA_MAX_BYTES) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'The image must be 5 MB or smaller' });
    const type = detectImageType(file.buffer);
    if (!type) throw new BadRequestException({ code: 'FILE_TYPE', message: 'Upload a JPG, PNG or WebP image' });
    const key = await this.storage.put(MEDIA_PREFIX, file.buffer, type);
    const name = key.slice(MEDIA_PREFIX.length + 1);
    await this.audit.log({ actorId, action: 'media.uploaded', entityType: 'Media', entityId: name, metadata: { type, bytes: file.size } });
    return { url: `/api/media/${name}` };
  }

  /** The stored image for a public /api/media/<name>, or null (unknown name, or not an image we serve). */
  async read(name: string): Promise<{ body: Buffer; contentType: string } | null> {
    if (!MEDIA_NAME_RE.test(name)) return null;
    const contentType = CONTENT_TYPES[name.slice(name.lastIndexOf('.') + 1)];
    if (!contentType) return null;
    const body = await this.storage.get(`${MEDIA_PREFIX}/${name}`);
    return body ? { body, contentType } : null;
  }

  async library(): Promise<MediaLibraryDto> {
    const [courses, events, speakers] = await Promise.all([
      this.prisma.course.findMany({
        orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
        select: {
          id: true,
          slug: true,
          titleEn: true,
          titleAr: true,
          status: true,
          coverImageUrl: true,
          youtubePlaylistUrl: true,
          sessions: { orderBy: { order: 'asc' }, select: { id: true, order: true, titleEn: true, titleAr: true, startsAt: true, recordingUrl: true } },
        },
      }),
      this.prisma.liveEvent.findMany({
        orderBy: { startsAt: 'desc' },
        select: {
          id: true,
          slug: true,
          titleEn: true,
          titleAr: true,
          status: true,
          startsAt: true,
          speakerName: true,
          coverImageUrl: true,
          speakerPhotoUrl: true,
          recordingUrl: true,
        },
      }),
      this.prisma.instructor.findMany({ orderBy: { name: 'asc' }, select: { id: true, slug: true, name: true, nameAr: true, photoUrl: true } }),
    ]);
    return {
      courses: courses.map((c) => ({ ...c, sessions: c.sessions.map((s) => ({ ...s, startsAt: s.startsAt.toISOString() })) })),
      events: events.map((e) => ({ ...e, startsAt: e.startsAt.toISOString() })),
      speakers,
    };
  }

  private async log(actorId: string, entityType: string, entityId: string, fields: string[]): Promise<void> {
    await this.audit.log({ actorId, action: 'media.updated', entityType, entityId, metadata: { fields } });
  }

  async updateCourse(id: string, input: MediaCourseInput, actorId: string) {
    const data = changes(input);
    // A team edit takes the course over from the archive import (see admin-courses.service.ts).
    const r = await this.prisma.course.updateMany({ where: { id }, data: { ...data, importHash: null } });
    if (!r.count) throw new NotFoundException('Course not found');
    await this.log(actorId, 'Course', id, Object.keys(data));
    return this.prisma.course.findUniqueOrThrow({ where: { id }, select: { id: true, coverImageUrl: true, youtubePlaylistUrl: true } });
  }

  async updateCourseSession(courseId: string, sessionId: string, input: MediaCourseSessionInput, actorId: string) {
    const data = changes(input);
    const r = await this.prisma.courseSession.updateMany({ where: { id: sessionId, courseId }, data });
    if (!r.count) throw new NotFoundException('Session not found');
    await this.prisma.course.updateMany({ where: { id: courseId, importHash: { not: null } }, data: { importHash: null } });
    await this.log(actorId, 'CourseSession', sessionId, Object.keys(data));
    return this.prisma.courseSession.findUniqueOrThrow({ where: { id: sessionId }, select: { id: true, recordingUrl: true } });
  }

  async updateEvent(id: string, input: MediaEventInput, actorId: string) {
    const data = changes(input);
    const r = await this.prisma.liveEvent.updateMany({ where: { id }, data: { ...data, importHash: null } });
    if (!r.count) throw new NotFoundException('Session not found');
    await this.log(actorId, 'LiveEvent', id, Object.keys(data));
    return this.prisma.liveEvent.findUniqueOrThrow({ where: { id }, select: { id: true, coverImageUrl: true, speakerPhotoUrl: true, recordingUrl: true } });
  }

  async updateInstructor(id: string, input: MediaInstructorInput, actorId: string) {
    const data = changes(input);
    const r = await this.prisma.instructor.updateMany({ where: { id }, data: { ...data, importHash: null } });
    if (!r.count) throw new NotFoundException('Instructor not found');
    await this.log(actorId, 'Instructor', id, Object.keys(data));
    return this.prisma.instructor.findUniqueOrThrow({ where: { id }, select: { id: true, photoUrl: true } });
  }
}
