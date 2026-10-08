/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventEnded } from '@academy/shared';
import { Prisma, type PrismaClient } from '@prisma/client';
import { parseArchive, type Archive, type ArchiveCourse, type ArchiveSession, type ArchiveSpeaker } from './archive-schema';

/**
 * Imports the archive (past courses, past live sessions, speakers) from prisma/archive/*.json.
 * Runs on every container start after the seed, so it must be idempotent and must never
 * overwrite an admin's work:
 *
 * - a record is matched by slug; one that isn't ours (`source` isn't "import") is left alone;
 * - an entry whose content hasn't changed since the last import (same `importHash`) is skipped;
 * - an imported record an admin has edited since (any audited admin action on it) is left alone;
 * - a record we imported and an admin later deleted or renamed is not recreated
 *   (the slugs ever imported are kept in the `__archiveImported` setting).
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
type Registry = Record<'speakers' | 'sessions' | 'courses', string[]>;

export interface ImportReport {
  created: string[];
  updated: string[];
  /** "kind:slug: reason" */
  skipped: string[];
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

export function plan(
  existing: { id: string; source: string | null; importHash: string | null } | null,
  hash: string,
  everImported: boolean,
  editedByAdmin: boolean,
): Plan {
  if (!existing) return everImported ? { action: 'skip', reason: 'deleted or renamed by an admin since it was imported' } : { action: 'create' };
  if (existing.source !== SOURCE) return { action: 'skip', reason: 'already exists (not created by the import)' };
  if (existing.importHash === hash) return { action: 'skip', reason: 'unchanged' };
  if (editedByAdmin) return { action: 'skip', reason: 'edited by an admin since it was imported' };
  return { action: 'update', id: existing.id };
}

async function editedByAdmin(tx: Tx, entityType: string, ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  return (await tx.auditLog.count({ where: { actorId: { not: null }, entityType, entityId: { in: ids } } })) > 0;
}

const date = (iso: string | undefined) => (iso ? new Date(iso) : null);
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

function sessionData(s: ArchiveSession, speakerId: string | null, now: Date) {
  const startsAt = new Date(s.startsAt);
  // An upcoming session registers people on the academy, so it needs a join link before it can go live.
  const status = s.status ?? (eventEnded(startsAt, s.durationMin, now) || s.liveUrl ? 'PUBLISHED' : 'DRAFT');
  return {
    status,
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
    startsAt,
    durationMin: s.durationMin,
    language: s.language,
    platform: s.platform,
    topics: s.topics,
    recordingUrl: s.recordingUrl ?? null,
    liveUrl: s.liveUrl ?? null,
    capacity: s.capacity ?? null,
  } satisfies Omit<Prisma.LiveEventUncheckedCreateInput, 'slug'>;
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
    publicRecordings: c.publicRecordings ?? c.status === 'COMPLETED',
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
  };
}

function lessonsData(c: ArchiveCourse) {
  return c.sessions.map((s, i) => ({
    order: i + 1,
    titleEn: s.titleEn,
    titleAr: s.titleAr || s.titleEn,
    descriptionEn: s.descriptionEn ?? null,
    descriptionAr: s.descriptionAr ?? null,
    startsAt: date(s.startsAt)!,
    durationMin: s.durationMin,
    topics: s.topics,
    recordingUrl: s.recordingUrl ?? null,
  }));
}

async function readRegistry(tx: Tx): Promise<Registry> {
  const row = await tx.setting.findUnique({ where: { key: IMPORTED_KEY } });
  const v = (row?.value ?? {}) as Partial<Record<keyof Registry, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return { speakers: list(v.speakers), sessions: list(v.sessions), courses: list(v.courses) };
}

/** Imports the archive. Safe to run any number of times (see the comment at the top). */
export async function importArchive(prisma: PrismaClient, archive: Archive, opts: { now?: Date } = {}): Promise<ImportReport> {
  const now = opts.now ?? new Date();
  const report: ImportReport = { created: [], updated: [], skipped: [] };
  const note = (kind: Kind, slug: string, p: Plan) => {
    if (p.action === 'skip') report.skipped.push(`${kind}:${slug}: ${p.reason}`);
    else report[p.action === 'create' ? 'created' : 'updated'].push(`${kind}:${slug}`);
  };

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(${LOCK_KEY}::bigint)`;
      const registry = await readRegistry(tx);
      const before = stable(registry);

      // ---- speakers
      for (const s of archive.speakers) {
        const data = speakerData(s);
        const hash = importHash(data);
        const existing = await tx.instructor.findUnique({ where: { slug: s.slug }, select: { id: true, source: true, importHash: true } });
        const p = plan(existing, hash, registry.speakers.includes(s.slug), existing ? await editedByAdmin(tx, 'Instructor', [existing.id]) : false);
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
        const data = sessionData(s, await speakerId(s.speaker), now);
        const hash = importHash(data);
        const existing = await tx.liveEvent.findUnique({ where: { slug: s.slug }, select: { id: true, source: true, importHash: true } });
        const p = plan(existing, hash, registry.sessions.includes(s.slug), existing ? await editedByAdmin(tx, 'LiveEvent', [existing.id]) : false);
        note('session', s.slug, p);
        if (p.action === 'create') {
          await tx.liveEvent.create({ data: { ...data, slug: s.slug, source: SOURCE, importHash: hash } });
          registry.sessions.push(s.slug);
        } else if (p.action === 'update') {
          await tx.liveEvent.update({ where: { id: p.id }, data: { ...data, importHash: hash } });
        }
      }

      // ---- courses
      for (const c of archive.courses) {
        const data = courseData(c);
        const lessons = lessonsData(c);
        const instructorIds = (await Promise.all(c.instructors.map(speakerId))).filter((id): id is string => Boolean(id));
        const hash = importHash({ data, lessons, instructorIds });
        const existing = await tx.course.findUnique({ where: { slug: c.slug }, select: { id: true, source: true, importHash: true } });
        let edited = false;
        if (existing) {
          const sessionIds = (await tx.courseSession.findMany({ where: { courseId: existing.id }, select: { id: true } })).map((x) => x.id);
          edited = (await editedByAdmin(tx, 'Course', [existing.id])) || (await editedByAdmin(tx, 'CourseSession', sessionIds));
        }
        const p = plan(existing, hash, registry.courses.includes(c.slug), edited);
        note('course', c.slug, p);
        if (p.action === 'skip') continue;

        const fields = { ...data, importHash: hash } satisfies Omit<Prisma.CourseUncheckedCreateInput, 'slug'>;
        let courseId: string;
        if (p.action === 'create') {
          courseId = (await tx.course.create({ data: { ...fields, slug: c.slug, source: SOURCE } })).id;
          registry.courses.push(c.slug);
        } else {
          courseId = p.id;
          await tx.course.update({ where: { id: courseId }, data: fields });
        }
        // Lessons are replaced only while no student has progress or feedback on them.
        const used =
          (await tx.sessionProgress.count({ where: { session: { courseId } } })) + (await tx.sessionFeedback.count({ where: { courseId } }));
        if (used === 0) {
          await tx.courseSession.deleteMany({ where: { courseId } });
          if (lessons.length) await tx.courseSession.createMany({ data: lessons.map((l) => ({ ...l, courseId })) });
        }
        await tx.courseInstructor.deleteMany({ where: { courseId } });
        if (instructorIds.length) {
          await tx.courseInstructor.createMany({ data: instructorIds.map((instructorId, order) => ({ courseId, instructorId, order })) });
        }
      }

      if (stable(registry) !== before) {
        await tx.setting.upsert({
          where: { key: IMPORTED_KEY },
          update: { value: registry as unknown as Prisma.InputJsonValue },
          create: { key: IMPORTED_KEY, value: registry as unknown as Prisma.InputJsonValue },
        });
      }
    },
    { maxWait: 30_000, timeout: 120_000 },
  );
  return report;
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
    const archive = readArchive();
    const report = await importArchive(prisma, archive);
    for (const line of report.created) console.log(`Archive: created ${line}`);
    for (const line of report.updated) console.log(`Archive: updated ${line}`);
    const unchanged = report.skipped.filter((s) => s.endsWith(': unchanged')).length;
    for (const line of report.skipped.filter((s) => !s.endsWith(': unchanged'))) console.log(`Archive: kept ${line}`);
    console.log(
      `Archive import done: ${report.created.length} created, ${report.updated.length} updated, ${unchanged} unchanged, ${report.skipped.length - unchanged} kept as edited.`,
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
