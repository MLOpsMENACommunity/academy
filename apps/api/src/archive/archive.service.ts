import { Injectable, NotFoundException } from '@nestjs/common';
import {
  courseAvailability,
  eventEnded,
  PUBLIC_COURSE_STATUSES,
  youtubeId,
  type PublicSpeakerDto,
  type RecordingDto,
  type RecordingsDto,
  type RecordingsQuery,
  type SpeakerRefDto,
} from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { speakerRefSelect, toSpeakerRef } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

/** The library is small (tens of items); this only bounds a bad day. */
const MAX_ITEMS = 500;

const insensitive = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/** Course lessons whose recordings are public: a public course that opted in. */
const publicCourse = { publicRecordings: true, status: { in: [...PUBLIC_COURSE_STATUSES] } } satisfies Prisma.CourseWhereInput;

/** The archive: the recordings library and speaker pages. Everything here is public. */
@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Past live sessions and course lessons with a public recording, newest first,
   * filtered by tag and by text (title, description, speaker, course).
   */
  async recordings(q: RecordingsQuery, now = new Date()): Promise<RecordingsDto> {
    const text = q.q?.trim();
    const eventBase = { status: 'PUBLISHED', recordingUrl: { not: null }, startsAt: { lte: now } } satisfies Prisma.LiveEventWhereInput;
    const sessionBase = { recordingUrl: { not: null }, startsAt: { lte: now }, course: publicCourse } satisfies Prisma.CourseSessionWhereInput;

    const eventWhere: Prisma.LiveEventWhereInput = {
      ...eventBase,
      ...(q.topic ? { topics: { has: q.topic } } : {}),
      ...(text
        ? {
            OR: [
              { titleEn: insensitive(text) },
              { titleAr: insensitive(text) },
              { descriptionEn: insensitive(text) },
              { descriptionAr: insensitive(text) },
              { speakerName: insensitive(text) },
              { speakerNameAr: insensitive(text) },
              { speaker: { is: { OR: [{ name: insensitive(text) }, { nameAr: insensitive(text) }] } } },
            ],
          }
        : {}),
    };
    const sessionWhere: Prisma.CourseSessionWhereInput = {
      ...sessionBase,
      ...(q.topic ? { topics: { has: q.topic } } : {}),
      ...(text
        ? {
            OR: [
              { titleEn: insensitive(text) },
              { titleAr: insensitive(text) },
              { descriptionEn: insensitive(text) },
              { descriptionAr: insensitive(text) },
              { course: { OR: [{ titleEn: insensitive(text) }, { titleAr: insensitive(text) }] } },
              {
                course: {
                  instructors: { some: { instructor: { OR: [{ name: insensitive(text) }, { nameAr: insensitive(text) }] } } },
                },
              },
            ],
          }
        : {}),
    };

    const [events, sessions, eventTags, sessionTags] = await Promise.all([
      this.prisma.liveEvent.findMany({
        where: eventWhere,
        orderBy: { startsAt: 'desc' },
        take: MAX_ITEMS,
        include: { speaker: { select: speakerRefSelect } },
      }),
      this.prisma.courseSession.findMany({
        where: sessionWhere,
        orderBy: { startsAt: 'desc' },
        take: MAX_ITEMS,
        include: {
          course: {
            select: {
              slug: true,
              titleEn: true,
              titleAr: true,
              instructors: { orderBy: { order: 'asc' }, select: { instructor: { select: speakerRefSelect } } },
            },
          },
        },
      }),
      this.prisma.liveEvent.findMany({ where: eventBase, select: { topics: true, startsAt: true, durationMin: true } }),
      this.prisma.courseSession.findMany({ where: sessionBase, select: { topics: true, startsAt: true, durationMin: true } }),
    ]);

    const items: RecordingDto[] = [
      ...events
        .filter((e) => e.recordingUrl && eventEnded(e.startsAt, e.durationMin, now))
        .map((e): RecordingDto => {
          const speakers: SpeakerRefDto[] = e.speaker
            ? [toSpeakerRef(e.speaker)]
            : e.speakerName
              ? [{ slug: null, name: e.speakerName, nameAr: e.speakerNameAr || null, titleEn: e.speakerTitleEn || null, titleAr: e.speakerTitleAr || null, photoUrl: e.speakerPhotoUrl }]
              : [];
          return {
            id: `event:${e.slug}`,
            kind: 'event',
            path: `/sessions/${e.slug}`,
            titleEn: e.titleEn,
            titleAr: e.titleAr || e.titleEn,
            course: null,
            startsAt: e.startsAt.toISOString(),
            durationMin: e.durationMin,
            topics: e.topics,
            recordingUrl: e.recordingUrl!,
            youtubeId: youtubeId(e.recordingUrl!),
            speakers,
          };
        }),
      ...sessions
        .filter((s) => s.recordingUrl && eventEnded(s.startsAt, s.durationMin, now))
        .map(
          (s): RecordingDto => ({
            id: `course:${s.course.slug}:${s.order}`,
            kind: 'course',
            path: `/courses/${s.course.slug}`,
            titleEn: s.titleEn,
            titleAr: s.titleAr || s.titleEn,
            course: { slug: s.course.slug, titleEn: s.course.titleEn, titleAr: s.course.titleAr || s.course.titleEn, order: s.order },
            startsAt: s.startsAt.toISOString(),
            durationMin: s.durationMin,
            topics: s.topics,
            recordingUrl: s.recordingUrl!,
            youtubeId: youtubeId(s.recordingUrl!),
            speakers: s.course.instructors.map((i) => toSpeakerRef(i.instructor)),
          }),
        ),
    ].sort((a, b) => b.startsAt.localeCompare(a.startsAt) || a.id.localeCompare(b.id));

    const counts = new Map<string, number>();
    for (const r of [...eventTags, ...sessionTags]) {
      if (!eventEnded(r.startsAt, r.durationMin, now)) continue;
      for (const tag of r.topics) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const topics = [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return { items, topics };
  }

  /** Speakers with something public to show (a published session or a public course). */
  private publicSpeaker(): Prisma.InstructorWhereInput {
    return {
      slug: { not: null },
      OR: [
        { events: { some: { status: { in: ['PUBLISHED', 'CANCELLED'] } } } },
        { courses: { some: { course: { status: { in: [...PUBLIC_COURSE_STATUSES] } } } } },
      ],
    };
  }

  async speakerSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    const rows = await this.prisma.instructor.findMany({ where: this.publicSpeaker(), select: { slug: true, updatedAt: true }, orderBy: { slug: 'asc' } });
    return rows.map((r) => ({ slug: r.slug!, updatedAt: r.updatedAt }));
  }

  async speaker(slug: string, now = new Date()): Promise<PublicSpeakerDto> {
    const s = await this.prisma.instructor.findFirst({
      where: { ...this.publicSpeaker(), slug },
      include: {
        events: { where: { status: { in: ['PUBLISHED', 'CANCELLED'] } }, orderBy: { startsAt: 'desc' } },
        courses: {
          where: { course: { status: { in: [...PUBLIC_COURSE_STATUSES] } } },
          include: { course: true },
        },
      },
    });
    if (!s) throw new NotFoundException('Speaker not found');
    return {
      slug: s.slug!,
      name: s.name,
      nameAr: s.nameAr,
      titleEn: s.titleEn,
      titleAr: s.titleAr,
      bioEn: s.bioEn,
      bioAr: s.bioAr,
      photoUrl: s.photoUrl,
      linkedinUrl: s.linkedinUrl,
      githubUrl: s.githubUrl,
      events: s.events.map((e) => {
        const past = eventEnded(e.startsAt, e.durationMin, now);
        return {
          slug: e.slug,
          status: e.status,
          titleEn: e.titleEn,
          titleAr: e.titleAr || e.titleEn,
          startsAt: e.startsAt.toISOString(),
          durationMin: e.durationMin,
          past,
          recordingUrl: past ? e.recordingUrl : null,
          topics: e.topics,
        };
      }),
      courses: s.courses
        .map(({ course: c }) => ({
          slug: c.slug,
          titleEn: c.titleEn,
          titleAr: c.titleAr || c.titleEn,
          availability: courseAvailability(c, now),
          completed: c.status === 'COMPLETED',
          cohortNumber: c.cohortNumber,
          startDate: c.startDate?.toISOString() ?? null,
          endDate: c.endDate?.toISOString() ?? null,
        }))
        .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
