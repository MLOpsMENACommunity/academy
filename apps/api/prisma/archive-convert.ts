/* eslint-disable no-console */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { slugify } from '@academy/shared';
import * as defaultCuration from './archive-curation';
import type { CuratedCoSpeaker, SessionDetails } from './archive-curation';
import { ARCHIVE_FORMAT_VERSION, archiveFileSchema, type ArchiveFileInput } from './archive-schema';

/**
 * One-off converter: the community website's data files -> prisma/archive/community-website.json.
 *
 *   pnpm --filter @academy/api archive:convert --website /path/to/website [--youtube-meta lengths.json]
 *
 * Durations come from the recordings' lengths in archive-sources/youtube-lengths.json.
 *
 * The JSON is committed and is what the import reads; run this again only to regenerate it
 * from the website. Arabic and data corrections live in archive-curation.ts.
 */

// ------------------------------------------------------------------ website shapes (the parts we read)

/** Shown for every part of an announced course that isn't decided yet. */
const COMING_SOON_EN = 'Will be announced soon.';
const COMING_SOON_AR = 'سيُعلَن عنه قريبًا.';

export interface WebsiteSession {
  slug: string;
  title: string;
  subtitle: string;
  speaker: string;
  speakerRole: string;
  startsAt: string;
  durationMinutes?: number;
  topics: string[];
  registerUrl?: string;
  sessionPageUrl?: string;
  youtubeId?: string;
  recordingUrl?: string;
  note?: string;
}

export interface WebsiteMember {
  name: string;
  role: string;
  photo: string;
  bio: string;
  linkedin: string;
}

export interface WebsiteCourse {
  slug: string;
  title: string;
  dates: { start: string; end: string };
  enrollUrl: string;
  repoUrl: string;
  summary: string;
  instructor: { name: string; role: string };
  objectives: readonly string[];
  includes: readonly string[];
  resources: readonly { label: string; href: string }[];
  outline: readonly { week: number; title: string; lessons: readonly string[]; project?: string; note?: string }[];
  requirements: readonly string[];
  description: { hook: string; body: readonly string[]; learnIntro: string; learn: readonly string[]; outro: string };
  audience: readonly string[];
}

export interface WebsiteUpcomingCourse {
  slug: string;
  title: string;
  summary: string;
  topics: readonly string[];
}

export interface WebsiteInput {
  sessions: WebsiteSession[];
  course: WebsiteCourse;
  upcomingCourses: WebsiteUpcomingCourse[];
  team: WebsiteMember[];
  youtube: { videos: { id: string; title: string; published: string }[] };
  /** Optional, from YouTube watch pages: video length, used for durations. */
  youtubeMeta?: Record<string, { lengthSeconds?: string | number | null }>;
  /** Files under apps/web/public that exist (e.g. "/speakers/aya-nasser-salama.webp"). */
  publicFiles?: string[];
}

export type Curation = typeof defaultCuration;

/** The website's default when a session has no duration (src/lib/sessions.ts). */
const WEBSITE_DEFAULT_MINUTES = 120;
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function videoMinutes(input: WebsiteInput, id: string | undefined | null): number | null {
  const s = id ? Number(input.youtubeMeta?.[id]?.lengthSeconds) : NaN;
  // Rounded up to 5 minutes; very short clips still count as a 15-minute slot (the schema minimum).
  return Number.isFinite(s) && s > 0 ? Math.max(15, Math.ceil(s / 300) * 5) : null;
}

const bullets = (items: readonly string[]) => items.map((x) => `- ${x}`).join('\n');
const paragraphs = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join('\n\n');

/** One item reads as a paragraph, several as a list. */
const block = (items: readonly string[]) => (items.length === 1 ? items[0]! : bullets(items));

/**
 * "Why attend", "What you'll learn" and "Requirements" from the owner's list, in the reader's
 * language. `lead`: the first paragraph, when the "why" is already said there.
 */
function detailsMarkdown(
  d: SessionDetails,
  lang: 'en' | 'ar',
  opts: { whyAsLead?: boolean } = {},
): string {
  const en = lang === 'en';
  const why = en ? d.whyEn : d.whyAr;
  const learn = en ? d.learnEn : d.learnAr;
  const req = (en ? d.requirementsEn : d.requirementsAr) ?? [];
  return paragraphs(
    !opts.whyAsLead &&
      why.length > 0 &&
      `### ${en ? 'Why attend' : 'لماذا تحضر هذه الجلسة'}\n\n${block(why)}`,
    learn.length > 0 && `### ${en ? "What you'll learn" : 'ما ستتعلمه'}\n\n${bullets(learn)}`,
    req.length > 0 && `### ${en ? 'Requirements' : 'المتطلبات'}\n\n${bullets(req)}`,
  );
}

export function convertWebsite(
  input: WebsiteInput,
  curation: Curation = defaultCuration,
): ArchiveFileInput {
  const out: Required<Pick<ArchiveFileInput, 'speakers' | 'sessions' | 'courses'>> = {
    speakers: [],
    sessions: [],
    courses: [],
  };
  const speakerSlugs = new Map<string, string>();

  /**
   * One speaker per person (by name), enriched from the team page when they're on it and
   * from the curated profile (Arabic, and roles or bios the website lacks).
   */
  const speaker = (name: string, role = ''): string => {
    const known = speakerSlugs.get(name);
    if (known) return known;
    const slug = slugify(name);
    const member = input.team.find((m) => m.name === name);
    const cur = curation.speakerProfiles[name] ?? {};
    const photo = `/speakers/${slug}.webp`;
    const bioEn = member?.bio || cur.bioEn || '';
    out.speakers.push({
      slug,
      name,
      ...(cur.nameAr ? { nameAr: cur.nameAr } : {}),
      titleEn: cur.titleEn ?? role,
      ...(cur.titleAr ? { titleAr: cur.titleAr } : {}),
      bioEn,
      ...(cur.bioAr && bioEn ? { bioAr: cur.bioAr } : {}),
      ...(input.publicFiles?.includes(photo) ? { photoUrl: photo } : {}),
      ...(cur.linkedinUrl || member?.linkedin ? { linkedinUrl: cur.linkedinUrl || member?.linkedin } : {}),
    });
    speakerSlugs.set(name, slug);
    return slug;
  };
  const coSpeakers = (list: CuratedCoSpeaker[] | undefined) =>
    (list ?? []).map((c) => ({ speaker: speaker(c.name), role: c.role }));

  // ---- The MLOps Practitioner (course 01), with its lessons as they ran
  const c = input.course;
  const instructor = speaker(c.instructor.name, c.instructor.role);
  const usedVideos = new Set<string>();
  const ar = curation.practitionerAr;
  const repo = c.resources.find((r) => /repository/i.test(r.label))?.href ?? c.repoUrl;
  const slides = c.resources.find((r) => /all session slides/i.test(r.label))?.href;
  const lessons = curation.practitionerLessons.map((l) => {
    const week = c.outline.find((w) => w.week === l.week);
    // Lesson 3's topic names are on the website's session entry; elsewhere the syllabus week's lessons.
    const asSession = Object.entries(curation.lessonSessions).find(([, v]) => v.course === c.slug && v.lesson === l.n)?.[0];
    const topicsEn = (asSession && input.sessions.find((s) => s.slug === asSession)?.topics) || week?.lessons || [];
    if (l.youtubeId) usedVideos.add(l.youtubeId);
    return {
      titleEn: l.titleEn,
      titleAr: l.titleAr,
      // Plain text shown line by line (lesson descriptions aren't markdown), like the seed's lessons.
      descriptionEn: topicsEn.map((x) => `• ${x}`).join('\n'),
      descriptionAr: (l.topicsAr.length === topicsEn.length ? l.topicsAr : topicsEn).map((x) => `• ${x}`).join('\n'),
      startsAt: l.airsAt,
      durationMin: videoMinutes(input, l.youtubeId) ?? 90,
      topics: l.tags,
      ...(l.youtubeId ? { recordingUrl: watchUrl(l.youtubeId) } : {}),
    };
  });
  out.courses.push({
    slug: c.slug,
    titleEn: c.title,
    // The website keeps the course's name in English in Arabic too.
    titleAr: c.title,
    shortDescriptionEn:
      'Take an ML model from notebook to production: packaging and APIs, experiment tracking and CI/CD, serving at scale, drift monitoring and model optimization. Cohort 1 ran Aug–Sep 2026; four of its five lessons are recorded.',
    shortDescriptionAr: ar.shortDescription,
    longDescriptionEn: paragraphs(
      c.summary,
      `**${c.description.hook}**`,
      ...c.description.body,
      c.description.learnIntro,
      bullets(c.description.learn),
      c.description.outro,
      '## Cohort 1',
      'Cohort 1 ran its five live lessons on YouTube Live from 16 August to 20 September 2026, with a project week and a final project. Lessons 1 to 4 are recorded; lesson 5 (Model Optimization, 20 September) has no public recording.',
      '## Course materials',
      bullets([`[Course repository](${repo}): all code, notebooks and module projects.`, ...(slides ? [`[Slides for every session](${slides}): a Google Drive folder.`] : [])]),
    ),
    longDescriptionAr: paragraphs(
      ar.summary,
      `**${ar.hook}**`,
      ar.body,
      ar.learnIntro,
      bullets(ar.learn),
      ar.outro,
      `## ${ar.cohortHeading}`,
      ar.cohortBody,
      `## ${ar.materialsHeading}`,
      bullets([`[${ar.repo.label}](${repo}): ${ar.repo.desc}`, ...(slides ? [`[${ar.slides.label}](${slides}): ${ar.slides.desc}`] : [])]),
    ),
    status: 'COMPLETED',
    type: 'FREE',
    price: 0,
    levels: [...curation.practitionerAudience.levels],
    language: curation.practitionerAudience.language,
    cohortNumber: 1,
    // The website's dates and its 7-week outline describe the plan; these are when the lessons ran.
    startDate: curation.practitionerDates.start,
    endDate: curation.practitionerDates.end,
    durationWeeks: curation.practitionerDates.weeks,
    publicRecordings: true,
    deliveryPlatform: 'YOUTUBE_LIVE',
    recordingsPlatform: 'YOUTUBE',
    topics: ['mlops', 'docker', 'ci-cd', 'model-serving', 'observability', 'model-optimization'],
    instructors: [instructor],
    targetAudience: { en: c.audience.map((a) => `- ${a}`).join('\n'), ar: ar.audience.map((a) => `- ${a}`).join('\n') },
    learningOutcomes: { en: [...c.objectives], ar: ar.objectives },
    prerequisites: { en: [...c.requirements], ar: ar.requirements },
    // In the order the weeks were taught (see practitionerWeekOrder).
    outline: [...c.outline]
      .sort(
        (a, b) =>
          curation.practitionerWeekOrder.indexOf(a.week) -
          curation.practitionerWeekOrder.indexOf(b.week),
      )
      .map((w) => {
        const wAr = curation.practitionerWeeksAr[w.week];
        const descriptionEn = w.project ?? w.note;
        return {
          titleEn: w.title,
          titleAr: wAr?.title ?? w.title,
          ...(descriptionEn ? { descriptionEn } : {}),
          ...(descriptionEn ? { descriptionAr: wAr?.description ?? descriptionEn } : {}),
        };
      }),
    included: {
      liveSessions: true,
      recordings: true,
      assignments: c.outline.some((w) => w.project),
      finalProject: c.outline.some((w) => /final project/i.test(w.title)),
      certificate: c.includes.some((i) => /certificate/i.test(i)),
    },
    sessions: lessons,
  });

  // ---- free live sessions
  for (const s of input.sessions) {
    if (curation.lessonSessions[s.slug]) continue;
    const cur = curation.sessions[s.slug];
    const youtubeId = s.youtubeId ?? cur?.youtubeId;
    if (youtubeId) usedVideos.add(youtubeId);
    const recordingUrl = youtubeId ? watchUrl(youtubeId) : s.recordingUrl;
    const topicsAr = cur?.topicsAr?.length === s.topics.length ? cur.topicsAr : s.topics;
    // The owner's "why / what you'll learn / requirements" replace the website's note and topic list.
    const d = cur?.details;
    out.sessions.push({
      slug: s.slug,
      titleEn: s.title,
      titleAr: cur?.titleAr ?? '',
      descriptionEn: d
        ? paragraphs(cur?.summaryEn ?? s.subtitle, detailsMarkdown(d, 'en'))
        : paragraphs(
            cur?.summaryEn ?? s.subtitle,
            s.note,
            s.topics.length > 0 && `### What we covered\n\n${bullets(s.topics)}`,
          ),
      descriptionAr: cur?.summaryAr
        ? d
          ? paragraphs(cur.summaryAr, detailsMarkdown(d, 'ar'))
          : paragraphs(
              cur.summaryAr,
              cur.noteAr,
              s.topics.length > 0 && `### ما تناولته الجلسة\n\n${bullets(topicsAr)}`,
            )
        : '',
      speaker: speaker(s.speaker, s.speakerRole),
      coSpeakers: coSpeakers(cur?.coSpeakers),
      startsAt: cur?.startsAt ?? s.startsAt,
      // A recording's length is what actually happened; otherwise what the website planned.
      durationMin: videoMinutes(input, youtubeId) ?? s.durationMinutes ?? WEBSITE_DEFAULT_MINUTES,
      topics: cur?.tags ?? [],
      ...(recordingUrl ? { recordingUrl } : {}),
    });
  }

  // ---- channel videos with no session on the website
  for (const v of input.youtube.videos) {
    if (usedVideos.has(v.id) || curation.skipVideos[v.id]) continue;
    const cur = curation.videos[v.id];
    const d = cur?.details;
    out.sessions.push({
      slug: cur?.slug ?? (slugify(v.title) || `video-${v.id.toLowerCase()}`),
      titleEn: cur?.titleEn ?? v.title,
      titleAr: cur?.titleAr ?? '',
      descriptionEn: paragraphs(cur?.descriptionEn, d && detailsMarkdown(d, 'en')),
      descriptionAr: cur?.descriptionAr
        ? paragraphs(cur.descriptionAr, d && detailsMarkdown(d, 'ar'))
        : '',
      ...(cur?.speaker ? { speaker: speaker(cur.speaker) } : {}),
      ...(cur?.coSpeakers ? { coSpeakers: coSpeakers(cur.coSpeakers) } : {}),
      ...(cur?.speakerName ? { speakerName: cur.speakerName } : {}),
      ...(cur?.speakerNameAr ? { speakerNameAr: cur.speakerNameAr } : {}),
      ...(cur?.speakerLinkedinUrl ? { speakerLinkedinUrl: cur.speakerLinkedinUrl } : {}),
      // Uploaded recordings: the upload time stands in for the session date, unless we know it.
      startsAt: cur?.startsAt ?? v.published,
      durationMin: videoMinutes(input, v.id) ?? 60,
      topics: cur?.tags ?? [],
      recordingUrl: watchUrl(v.id),
    });
  }

  // ---- past sessions only the owner's list has (no website entry, no recording yet)
  for (const e of curation.extraSessions) {
    out.sessions.push({
      slug: e.slug,
      titleEn: e.titleEn,
      titleAr: e.titleAr,
      descriptionEn: paragraphs(
        block(e.details.whyEn),
        detailsMarkdown(e.details, 'en', { whyAsLead: true }),
      ),
      descriptionAr: paragraphs(
        block(e.details.whyAr),
        detailsMarkdown(e.details, 'ar', { whyAsLead: true }),
      ),
      speaker: speaker(e.speaker),
      coSpeakers: coSpeakers(e.coSpeakers),
      startsAt: e.startsAt,
      durationMin: e.durationMin,
      topics: e.tags,
    });
  }

  // ---- announced courses
  for (const u of input.upcomingCourses) {
    const uAr = curation.upcomingAr[u.slug];
    out.courses.push({
      slug: u.slug,
      titleEn: u.title,
      titleAr: uAr?.title ?? u.title,
      shortDescriptionEn: u.summary,
      shortDescriptionAr: uAr?.summary ?? u.summary,
      // Curriculum, format and what's included aren't decided yet: say so instead of guessing.
      longDescriptionEn: COMING_SOON_EN,
      longDescriptionAr: COMING_SOON_AR,
      status: 'COMING_SOON',
      // The price isn't announced: "Price to be announced" rather than claiming it's free.
      type: 'PAID',
      price: 0,
      level: 'INTERMEDIATE',
      topics: ['llmops'],
      learningOutcomes: { en: [COMING_SOON_EN], ar: [COMING_SOON_AR] },
      included: {
        liveSessions: false,
        recordings: false,
        assignments: false,
        finalProject: false,
        certificate: false,
        notesEn: COMING_SOON_EN,
        notesAr: COMING_SOON_AR,
      },
    });
  }

  out.sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  // Each session's shelf in the recordings library.
  for (const s of out.sessions) {
    const category = curation.sessionCategories[s.slug];
    if (category) s.category = category;
  }
  const file: ArchiveFileInput = {
    version: ARCHIVE_FORMAT_VERSION,
    source:
      'Generated by prisma/archive-convert.ts from the MLOps MENA community website (data/sessions.ts, data/mlops-practitioner.ts, data/offerings.ts, data/team.ts, data/generated/youtube.json) and prisma/archive-curation.ts.',
    ...out,
  };
  // Fail here rather than at import time.
  archiveFileSchema.parse(file);
  return file;
}

// ------------------------------------------------------------------ CLI

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const website = resolve(arg('website') ?? '../../../website');
  const outFile = resolve(arg('out') ?? join(__dirname, 'archive', 'community-website.json'));
  const metaFile = arg('youtube-meta') ?? join(__dirname, 'archive-sources', 'youtube-lengths.json');
  const load = async <T>(rel: string): Promise<T> => (await import(pathToFileURL(join(website, rel)).href)) as T;

  const { sessions } = await load<{ sessions: WebsiteSession[] }>('data/sessions.ts');
  const { course } = await load<{ course: WebsiteCourse }>('data/mlops-practitioner.ts');
  const { upcomingCourse } = await load<{ upcomingCourse: WebsiteUpcomingCourse }>('data/offerings.ts');
  const team = await load<{ founder: WebsiteMember; directors: WebsiteMember[]; leads: WebsiteMember[] }>('data/team.ts');
  const youtube = JSON.parse(readFileSync(join(website, 'data/generated/youtube.json'), 'utf8')) as WebsiteInput['youtube'];
  const publicDir = join(__dirname, '..', '..', 'web', 'public');

  const file = convertWebsite({
    sessions,
    course,
    upcomingCourses: [upcomingCourse],
    team: [team.founder, ...team.directors, ...team.leads],
    youtube,
    youtubeMeta: existsSync(metaFile) ? (JSON.parse(readFileSync(resolve(metaFile), 'utf8')) as { videos: WebsiteInput['youtubeMeta'] }).videos : undefined,
    publicFiles: existsSync(join(publicDir, 'speakers')) ? readdirSync(join(publicDir, 'speakers')).map((f) => `/speakers/${f}`) : [],
  });
  writeFileSync(outFile, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Wrote ${outFile}: ${file.speakers?.length} speakers, ${file.sessions?.length} sessions, ${file.courses?.length} courses.`);
  for (const s of file.speakers ?? []) {
    if (!s.photoUrl) console.log(`  No photo for ${s.slug}: add apps/web/public/speakers/${s.slug}.webp (≤400px) and run again.`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
