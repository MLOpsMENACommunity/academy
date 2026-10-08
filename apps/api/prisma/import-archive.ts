/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventEnded } from '@academy/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ARCHIVE_FORMAT_VERSION, parseArchive, type Archive, type ArchiveCourse, type ArchiveSession, type ArchiveSpeaker } from './archive-schema';

/**
 * Imports the archive (past courses, past live sessions, speakers) from prisma/archive/*.json.
 * Runs on every container start after the seed, so it must be idempotent, cheap when
 * nothing changed, and must never overwrite an admin's work:
 *
 * - a record is matched by slug; one that isn't ours (`source` isn't "import") is left alone;
 * - every admin save of an imported record clears its `importHash` (the admin services do it):
 *   from then on the record is the admin's and the import never touches it again;
 * - an entry whose content hasn't changed since the last import (same `importHash`) is skipped;
 * - a record we imported and an admin later deleted or renamed is not recreated
 *   (the slugs ever imported are kept in the `__archiveImported` setting);
 * - when no archive file changed since the last successful import, nothing is read at all.
 *
 * Everything else is created, or updated in place when its entry changed.
 */

const SOURCE = 'import';
/** Setting row with every slug the import has ever created (not a user-facing setting). */
const IMPORTED_KEY = '__archiveImported';
/** One import at a time, even when several containers start together. */
const LOCK_KEY = 4_202_610_110;

type Tx = Prisma.TransactionClient;
type Kind = 'speaker' | 'session' | 'course';
interface Registry {
  speakers: string[];
  sessions: string[];
  courses: string[];
  /** Hash of the whole archive at the last successful import. */
  archiveHash?: string;
}

export interface ImportReport {
  created: string[];
  updated: string[];
  /** "kind:slug: reason" */
  skipped: string[];
  /** True when the archive was unchanged since the last import and nothing was read. */
  unchangedArchive?: boolean;
}

/** Stable JSON (sorted keys) so the hash only changes when the content does. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function importHash(data: unknown): string {
  return createHash('sha256').update(stable(data)).digest('hex').slice(0, 32);
}

/** What to do with one entry, given what the database holds for its slug. */
export type Plan = { action: 'create' } | { action: 'update'; id: string } | { action: 'skip'; reason: string };

export function plan(existing: { id: string; source: string | null; importHash: string | null } | null, hash: string, everImported: boolean): Plan {
  if (!existing) return everImported ? { action: 'skip', reason: 'deleted or renamed by an admin since it was imported' } : { action: 'create' };
  if (existing.source !== SOURCE) return { action: 'skip', reason: 'already exists (not created by the import)' };
  if (existing.importHash === null) return { action: 'skip', reason: 'edited by an admin since it was imported' };
  if (existing.importHash === hash) return { action: 'skip', reason: 'unchanged' };
  return { action: 'update', id: existing.id };
}

const date = (iso: string) => new Date(iso);
/** A calendar day from the archive ("2026-08-15") as midnight Cairo time, like the admin's date fields. */
const dayStart = (d: string | undefined) => (d ? new Date(`${d}T00:00:00+03:00`) : null);

function speakerData(s: ArchiveSpeaker) {
  return {
    name: s.name,
    nameAr: s.nameAr || null,
    titleEn: s.titleEn,
    titleAr: s.titleAr || null,
    bioEn: s.bioEn,
    bioAr: s.bioAr || null,
    photoUrl: s.photoUrl ?? null,
    linkedinUrl: s.linkedinUrl ?? null,
    githubUrl: s.githubUrl ?? null,
  };
}

/** Everything but the status (see sessionStatus): the part that is hashed and updated. */
function sessionData(s: ArchiveSession, speakerId: string | null) {
  return {
    titleEn: s.titleEn,
    titleAr: s.titleAr,
    descriptionEn: s.descriptionEn,
    descriptionAr: s.descriptionAr,
    // A linked speaker profile provides name, title, photo and LinkedIn; otherwise the free-text speaker.
    speakerId,
    speakerName: speakerId ? '' : (s.speakerName ?? ''),
    speakerNameAr: speakerId ? '' : (s.speakerNameAr ?? ''),
    speakerTitleEn: speakerId ? '' : (s.speakerTitleEn ?? ''),
    speakerTitleAr: speakerId ? '' : (s.speakerTitleAr ?? ''),
    speakerPhotoUrl: null,
    speakerLinkedinUrl: speakerId ? null : (s.speakerLinkedinUrl ?? null),
    startsAt: date(s.startsAt),
    durationMin: s.durationMin,
    language: s.language,
    platform: s.platform,
    topics: s.topics,
    recordingUrl: s.recordingUrl ?? null,
    liveUrl: s.liveUrl ?? null,
    capacity: s.capacity ?? null,
  } satisfies Omit<Prisma.LiveEventUncheckedCreateInput, 'slug'>;
}

/**
 * The status a new session starts with. An upcoming session registers people on the academy,
 * so without a join link it waits as a draft. Decided once, at creation: the import never
 * changes a status on its own later (a draft doesn't go public just because its date passed).
 */
function sessionStatus(s: ArchiveSession, now: Date): 'PUBLISHED' | 'DRAFT' {
  return s.status ?? (eventEnded(date(s.startsAt), s.durationMin, now) || s.liveUrl ? 'PUBLISHED' : 'DRAFT');
}

function courseData(c: ArchiveCourse) {
  return {
    titleEn: c.titleEn,
    titleAr: c.titleAr,
    shortDescriptionEn: c.shortDescriptionEn,
    shortDescriptionAr: c.shortDescriptionAr,
    longDescriptionEn: c.longDescriptionEn,
    longDescriptionAr: c.longDescriptionAr,
    type: c.type,
    price: c.price,
    currency: c.currency,
    // Nobody applies to an archived cohort; an admin opening a new cohort sets this.
    requiresApproval: c.status !== 'COMPLETED',
    status: c.status,
    level: c.level,
    language: c.language,
    cohortNumber: c.cohortNumber ?? null,
    startDate: dayStart(c.startDate),
    endDate: dayStart(c.endDate),
    durationWeeks: c.durationWeeks ?? null,
    hoursPerWeek: c.hoursPerWeek ?? null,
    externalPlatform: c.externalPlatform ?? null,
    externalUrl: c.externalUrl ?? null,
    // Only free courses with YouTube recordings can make them public (paid recordings stay enrolled-only).
    publicRecordings: c.type === 'FREE' && c.recordingsPlatform === 'YOUTUBE' && (c.publicRecordings ?? c.status === 'COMPLETED'),
    deliveryPlatform: c.deliveryPlatform,
    recordingsPlatform: c.recordingsPlatform,
    youtubePlaylistUrl: c.youtubePlaylistUrl ?? null,
    topics: c.topics,
    targetAudience: c.targetAudience,
    notFor: c.notFor,
    learningOutcomes: c.learningOutcomes,
    prerequisites: c.prerequisites,
    outline: c.outline,
    faq: c.faq,
    included: c.included,
  } satisfies Omit<Prisma.CourseUncheckedCreateInput, 'slug'>;
}

function lessonsData(c: ArchiveCourse) {
  return c.sessions.map((s, i) => ({
    order: i + 1,
    titleEn: s.titleEn,
    titleAr: s.titleAr || s.titleEn,
    descriptionEn: s.descriptionEn ?? null,
    descriptionAr: s.descriptionAr ?? null,
    startsAt: date(s.startsAt),
    durationMin: s.durationMin,
    topics: s.topics,
    recordingUrl: s.recordingUrl ?? null,
  }));
}
type Lesson = ReturnType<typeof lessonsData>[number];

async function readRegistry(tx: Tx | PrismaClient): Promise<Registry> {
  const row = await tx.setting.findUnique({ where: { key: IMPORTED_KEY } });
  const v = (row?.value ?? {}) as Partial<Record<keyof Registry, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return {
    speakers: list(v.speakers),
    sessions: list(v.sessions),
    courses: list(v.courses),
    ...(typeof v.archiveHash === 'string' ? { archiveHash: v.archiveHash } : {}),
  };
}

/**
 * Imports the archive. Safe to run any number of times (see the comment at the top).
 * `force` re-checks every entry even when the archive files haven't changed.
 */
export async function importArchive(prisma: PrismaClient, archive: Archive, opts: { now?: Date; force?: boolean } = {}): Promise<ImportReport> {
  const now = opts.now ?? new Date();
  const report: ImportReport = { created: [], updated: [], skipped: [] };
  const archiveHash = importHash({ version: ARCHIVE_FORMAT_VERSION, archive });
  // The common case on a container start: one query, no transaction.
  if (!opts.force && (await readRegistry(prisma)).archiveHash === archiveHash) return { ...report, unchangedArchive: true };

  const note = (kind: Kind, slug: string, p: Plan) => {
    if (p.action === 'skip') report.skipped.push(`${kind}:${slug}: ${p.reason}`);
    else report[p.action === 'create' ? 'created' : 'updated'].push(`${kind}:${slug}`);
  };

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(${LOCK_KEY}::bigint)`;
      const registry = await readRegistry(tx);

      // ---- speakers
      for (const s of archive.speakers) {
        const data = speakerData(s);
        const hash = importHash(data);
        const existing = await tx.instructor.findUnique({ where: { slug: s.slug }, select: { id: true, source: true, importHash: true } });
        const p = plan(existing, hash, registry.speakers.includes(s.slug));
        note('speaker', s.slug, p);
        if (p.action === 'create') {
          await tx.instructor.create({ data: { ...data, slug: s.slug, source: SOURCE, importHash: hash } });
          registry.speakers.push(s.slug);
        } else if (p.action === 'update') {
          await tx.instructor.update({ where: { id: p.id }, data: { ...data, importHash: hash } });
        }
      }

      const speakerIds = new Map<string, string | null>();
      const speakerId = async (slug: string | undefined) => {
        if (!slug) return null;
        if (!speakerIds.has(slug)) speakerIds.set(slug, (await tx.instructor.findUnique({ where: { slug }, select: { id: true } }))?.id ?? null);
        return speakerIds.get(slug)!;
      };

      // ---- live sessions
      for (const s of archive.sessions) {
        const data = sessionData(s, await speakerId(s.speaker));
        // An explicit status in the entry is content; the computed default is not (see sessionStatus).
        const hash = importHash({ data, status: s.status ?? null });
        const existing = await tx.liveEvent.findUnique({ where: { slug: s.slug }, select: { id: true, source: true, importHash: true } });
        const p = plan(existing, hash, registry.sessions.includes(s.slug));
        note('session', s.slug, p);
        if (p.action === 'create') {
          await tx.liveEvent.create({ data: { ...data, status: sessionStatus(s, now), slug: s.slug, source: SOURCE, importHash: hash } });
          registry.sessions.push(s.slug);
        } else if (p.action === 'update') {
          await tx.liveEvent.update({ where: { id: p.id }, data: { ...data, ...(s.status ? { status: s.status } : {}), importHash: hash } });
        }
      }

      // ---- courses
      for (const c of archive.courses) {
        const data = courseData(c);
        const lessons = lessonsData(c);
        const instructorIds = (await Promise.all(c.instructors.map(speakerId))).filter((id): id is string => Boolean(id));
        const hash = importHash({ data, lessons, instructorIds });
        const existing = await tx.course.findUnique({ where: { slug: c.slug }, select: { id: true, source: true, importHash: true } });
        let p = plan(existing, hash, registry.courses.includes(c.slug));
        let replaceLessons = true;
        if (p.action === 'update') {
          const current = await tx.courseSession.findMany({ where: { courseId: p.id }, orderBy: { order: 'asc' } });
          replaceLessons = stable(current.map((l) => pickLesson(l))) !== stable(lessons);
          // Lessons with student progress or feedback keep their ids: hold the whole update back
          // rather than store a hash that claims lessons were imported when they weren't.
          if (replaceLessons) {
            const used =
              (await tx.sessionProgress.count({ where: { session: { courseId: p.id } } })) + (await tx.sessionFeedback.count({ where: { courseId: p.id } }));
            if (used > 0) p = { action: 'skip', reason: 'its lessons changed, but students have progress on them: update it in the admin' };
          }
        }
        note('course', c.slug, p);
        if (p.action === 'skip') continue;

        let courseId: string;
        if (p.action === 'create') {
          courseId = (await tx.course.create({ data: { ...data, importHash: hash, slug: c.slug, source: SOURCE } })).id;
          registry.courses.push(c.slug);
        } else {
          courseId = p.id;
          await tx.course.update({ where: { id: courseId }, data: { ...data, importHash: hash } });
        }
        if (replaceLessons) {
          await tx.courseSession.deleteMany({ where: { courseId } });
          if (lessons.length) await tx.courseSession.createMany({ data: lessons.map((l) => ({ ...l, courseId })) });
        }
        await tx.courseInstructor.deleteMany({ where: { courseId } });
        if (instructorIds.length) {
          await tx.courseInstructor.createMany({ data: instructorIds.map((instructorId, order) => ({ courseId, instructorId, order })) });
        }
      }

      registry.archiveHash = archiveHash;
      await tx.setting.upsert({
        where: { key: IMPORTED_KEY },
        update: { value: registry as unknown as Prisma.InputJsonValue },
        create: { key: IMPORTED_KEY, value: registry as unknown as Prisma.InputJsonValue },
      });
    },
    { maxWait: 30_000, timeout: 120_000 },
  );
  return report;
}

/** A stored lesson in the shape lessonsData() produces, to compare them. */
function pickLesson(l: Lesson): Lesson {
  return {
    order: l.order,
    titleEn: l.titleEn,
    titleAr: l.titleAr,
    descriptionEn: l.descriptionEn,
    descriptionAr: l.descriptionAr,
    startsAt: l.startsAt,
    durationMin: l.durationMin,
    topics: l.topics,
    recordingUrl: l.recordingUrl,
  };
}

/** prisma/archive next to this file (tsx), or next to dist/prisma (the built image). */
export function archiveDir(): string {
  const candidates = [join(__dirname, 'archive'), join(__dirname, '..', '..', 'prisma', 'archive')];
  return candidates.find((d) => existsSync(d)) ?? candidates[0]!;
}

export function readArchive(dir = archiveDir()): Archive {
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((name) => ({ name, data: JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown }))
    : [];
  return parseArchive(files);
}

async function main(): Promise<void> {
  // Local runs read apps/api/.env; containers get their env from the orchestrator.
  try {
    process.loadEnvFile();
  } catch {
    // no .env file: fine
  }
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const report = await importArchive(prisma, readArchive(), { force: process.argv.includes('--force') });
    if (report.unchangedArchive) {
      console.log('Archive import: no archive file changed since the last import (run with --force to re-check every entry).');
      return;
    }
    for (const line of report.created) console.log(`Archive: created ${line}`);
    for (const line of report.updated) console.log(`Archive: updated ${line}`);
    const unchanged = report.skipped.filter((s) => s.endsWith(': unchanged')).length;
    for (const line of report.skipped.filter((s) => !s.endsWith(': unchanged'))) console.log(`Archive: kept ${line}`);
    console.log(
      `Archive import done: ${report.created.length} created, ${report.updated.length} updated, ${unchanged} unchanged, ${report.skipped.length - unchanged} kept as they are.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
