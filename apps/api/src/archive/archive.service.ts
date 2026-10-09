import { Injectable, NotFoundException } from '@nestjs/common';
import {
  courseAvailability,
  eventEnded,
  foldSearch,
  PUBLIC_COURSE_STATUSES,
  searchTerms,
  TOPIC_LABELS,
  youtubeId,
  type PublicSpeakerDto,
  type RecordingDto,
  type RecordingsDto,
  type RecordingsQuery,
  type SpeakerRefDto,
} from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { speakerRefSelect, toCoSpeakers, toSpeakerRef } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

/** The whole library is small (tens of items, hundreds one day): it's built once a minute and filtered in memory. */
const LIBRARY_TTL_MS = 60_000;
const MAX_ITEMS = 2_000;

/** Course lessons whose recordings are public: a free public course that opted in. */
const publicCourse = { publicRecordings: true, type: 'FREE', status: { in: [...PUBLIC_COURSE_STATUSES] } } satisfies Prisma.CourseWhereInput;

interface LibraryItem {
  item: RecordingDto;
  /** Ends at, for "has it ended yet" at request time. */
  endsAt: number;
  /** Lowercased title, description, speakers and course, for the text search. */
  text: string;
}

/** Searchable text: the given fields, plus each tag's English and Arabic label. */
const searchText = (fields: (string | null | undefined)[], topics: string[]) =>
  foldSearch(
    [...fields, ...topics.flatMap((t) => [t, TOPIC_LABELS[t]?.en ?? '', TOPIC_LABELS[t]?.ar ?? ''])]
      .filter(Boolean)
      .join('\n'),
  );

/** The archive: the recordings library and speaker pages. Everything here is public. */
@Injectable()
export class ArchiveService {
  private library: { at: number; items: LibraryItem[] } | null = null;
  private loading: Promise<LibraryItem[]> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Past live sessions and course lessons with a public recording, newest first,
   * filtered by tag and by text (title, description, speaker, course).
   *
   * Public and unthrottled (pages render server-side from one IP), so a request never
   * reaches the database: it filters a copy of the library refreshed at most once a minute.
   */
  async recordings(q: RecordingsQuery, now = new Date()): Promise<RecordingsDto> {
    const ended = (await this.libraryItems()).filter((x) => x.endsAt < now.getTime());
    const counts = new Map<string, number>();
    for (const { item } of ended)
      for (const tag of item.topics) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    // A topic the library doesn't have (a typo, an old link) is ignored rather than matching nothing.
    const topic = q.topic && counts.has(q.topic) ? q.topic : undefined;
    const terms = searchTerms(q.q ?? '');
    const items = ended
      .filter(
        (x) =>
          (!topic || x.item.topics.includes(topic)) &&
          (!terms || terms.some((t) => x.text.includes(t))),
      )
      .map((x) => x.item);

    const topics = [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return { items, topics };
  }

  private async libraryItems(): Promise<LibraryItem[]> {
    if (this.library && Date.now() - this.library.at < LIBRARY_TTL_MS) return this.library.items;
    // One load at a time, shared by concurrent requests.
    this.loading ??= this.loadLibrary()
      .then((items) => {
        this.library = { at: Date.now(), items };
        return items;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async loadLibrary(): Promise<LibraryItem[]> {
    const [events, sessions] = await Promise.all([
      this.prisma.liveEvent.findMany({
        where: { status: 'PUBLISHED', recordingUrl: { not: null } },
        orderBy: { startsAt: 'desc' },
        take: MAX_ITEMS,
        include: {
          speaker: { select: speakerRefSelect },
          coSpeakers: {
            orderBy: { order: 'asc' },
            select: { role: true, instructorId: true, instructor: { select: speakerRefSelect } },
          },
        },
      }),
      this.prisma.courseSession.findMany({
        where: { recordingUrl: { not: null }, course: publicCourse },
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
    ]);
    const names = (list: SpeakerRefDto[]) => list.flatMap((s) => [s.name, s.nameAr ?? '']);

    const out: LibraryItem[] = [
      ...events
        .filter((e) => e.recordingUrl)
        .map((e): LibraryItem => {
          const main: SpeakerRefDto[] = e.speaker
            ? [toSpeakerRef(e.speaker)]
            : e.speakerName
              ? [{ slug: null, name: e.speakerName, nameAr: e.speakerNameAr || null, titleEn: e.speakerTitleEn || null, titleAr: e.speakerTitleAr || null, photoUrl: e.speakerPhotoUrl }]
              : [];
          // The main speaker first, then hosts and guests (their names are searchable too).
          const speakers: SpeakerRefDto[] = [
            ...main,
            ...toCoSpeakers(e).map(({ role: _role, ...ref }) => ref),
          ];
          const item: RecordingDto = {
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
          return {
            item,
            endsAt: e.startsAt.getTime() + e.durationMin * 60_000,
            text: searchText(
              [e.titleEn, e.titleAr, e.descriptionEn, e.descriptionAr, ...names(speakers)],
              e.topics,
            ),
          };
        }),
      ...sessions
        .filter((s) => s.recordingUrl)
        .map((s): LibraryItem => {
          const speakers = s.course.instructors.map((i) => toSpeakerRef(i.instructor));
          const item: RecordingDto = {
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
            speakers,
          };
          return {
            item,
            endsAt: s.startsAt.getTime() + s.durationMin * 60_000,
            text: searchText(
              [
                s.titleEn,
                s.titleAr,
                s.descriptionEn,
                s.descriptionAr,
                s.course.titleEn,
                s.course.titleAr,
                ...names(speakers),
              ],
              s.topics,
            ),
          };
        }),
    ];
    return out.sort((a, b) => b.item.startsAt.localeCompare(a.item.startsAt) || a.item.id.localeCompare(b.item.id));
  }

  /** Speakers with something public to show (a published session or a public course). */
  private publicSpeaker(): Prisma.InstructorWhereInput {
    return {
      slug: { not: null },
      OR: [
        { events: { some: { status: { in: ['PUBLISHED', 'CANCELLED'] } } } },
        { coSpeaking: { some: { event: { status: { in: ['PUBLISHED', 'CANCELLED'] } } } } },
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
        events: {
          where: { status: { in: ['PUBLISHED', 'CANCELLED'] } },
          orderBy: { startsAt: 'desc' },
        },
        coSpeaking: {
          where: { event: { status: { in: ['PUBLISHED', 'CANCELLED'] } } },
          include: { event: true },
        },
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
      // Sessions they gave, and those they hosted or joined as a guest, newest first.
      events: [
        ...s.events.map((e) => ({ e, role: null })),
        ...s.coSpeaking
          .filter((c) => c.event.speakerId !== s.id)
          .map((c) => ({ e: c.event, role: c.role })),
      ]
        .sort((a, b) => b.e.startsAt.getTime() - a.e.startsAt.getTime())
        .map(({ e, role }) => {
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
            role,
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
