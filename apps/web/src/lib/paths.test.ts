import type { CourseSummaryDto, RecordingDto } from '@academy/shared';
import { describe, expect, it } from 'vitest';
import { buildMenuData } from '@/components/layout/menu';
import { courseStatus, findPath, LEARNING_PATHS, resolveSteps } from './paths';

const course = (slug: string, over: Partial<CourseSummaryDto> = {}): CourseSummaryDto =>
  ({
    id: slug,
    slug,
    titleEn: `Course ${slug}`,
    titleAr: `دورة ${slug}`,
    shortDescriptionEn: 'Short',
    shortDescriptionAr: 'قصير',
    type: 'FREE',
    price: 0,
    currency: 'EGP',
    level: 'BEGINNER',
    levels: ['JUNIOR'],
    levelProgression: false,
    language: 'AR',
    startDate: null,
    applicationDeadline: null,
    durationWeeks: null,
    hoursPerWeek: null,
    coverImageUrl: null,
    availability: 'UPCOMING',
    seatsRemaining: null,
    instructorNames: ['Aya'],
    completed: false,
    cohortNumber: null,
    endDate: null,
    topics: [],
    ...over,
  }) as CourseSummaryDto;

const recording = (slug: string): RecordingDto => ({
  id: `event:${slug}`,
  kind: 'event',
  path: `/sessions/${slug}`,
  titleEn: `Talk ${slug}`,
  titleAr: `جلسة ${slug}`,
  course: null,
  startsAt: '2026-05-01T16:00:00.000Z',
  durationMin: 90,
  topics: [],
  category: 'HANDS_ON',
  recordingUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  youtubeId: 'abcdefghijk',
  speakers: [{ slug: 'x', name: 'Speaker', nameAr: 'متحدث', titleEn: null, titleAr: null, photoUrl: null }],
});

describe('learning paths', () => {
  it('have unique slugs and at least two steps each', () => {
    expect(new Set(LEARNING_PATHS.map((p) => p.slug)).size).toBe(LEARNING_PATHS.length);
    for (const p of LEARNING_PATHS) expect(p.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('resolve steps in order and leave out what is not public', () => {
    const path = findPath('kubernetes-for-ml')!;
    const steps = resolveSteps(path, [course('kubernetes')], [recording('docker-deep-dive')], 'ar');
    expect(steps.map((s) => s.slug)).toEqual(['docker-deep-dive', 'kubernetes']);
    expect(steps[0]).toMatchObject({ kind: 'recording', title: 'جلسة docker-deep-dive', status: 'recording', people: ['متحدث'], path: '/sessions/docker-deep-dive', external: false });
    expect(steps[1]).toMatchObject({ kind: 'course', status: 'upcoming', path: '/courses/kubernetes' });
  });

  it('maps course availability to a step status', () => {
    expect(courseStatus({ completed: false, availability: 'OPEN' })).toBe('open');
    expect(courseStatus({ completed: true, availability: 'CLOSED' })).toBe('completed');
    expect(courseStatus({ completed: false, availability: 'CLOSED' })).toBe('closed');
  });
});

describe('header menu data', () => {
  it('counts courses and features open, then upcoming, then past ones', () => {
    const data = buildMenuData([course('a', { completed: true }), course('b'), course('c', { availability: 'OPEN' }), course('d', { availability: 'CLOSED' })], 'en');
    expect(data.coursesLine).toBe('4 courses · 1 taking applications');
    expect(data.featured.map((f) => f.href)).toEqual(['/en/courses/c', '/en/courses/b', '/en/courses/a']);
    expect(data.featured.map((f) => f.tone)).toEqual(['success', 'accent', 'muted']);
  });

  it('is empty when the course list could not be loaded', () => {
    expect(buildMenuData(null, 'ar')).toEqual({ coursesLine: null, featured: [], roadmaps: [] });
  });
});

/** The owner's order (9 Oct 2026): not release order, so no dates are shown. */
const MLOPS_ENGINEER_ORDER: [string, string, 'live' | 'video'][] = [
  ['MLOps Course Guide', 'n0dv6KZHq9M', 'video'],
  ['MLOps #1: From Notebook to Production-Ready ML Code', 'rJFIn83w0Dc', 'live'],
  ['Hands-on FastAPI and backend for MLOps', 'asIGEjkUQCI', 'video'],
  ['Hands-on Docker', 'AFcoKDtyhec', 'video'],
  ['MLOps #2: MLflow, DVC & GitHub Actions', 'slxkWpCAqI8', 'live'],
  ['Hands-on CI/CD pipelines', 'pkZcMjF1znU', 'video'],
  ['MLOps #3: Model Serving at Scale', 'Gnro52bcUsg', 'video'],
  ['Kubernetes Deployment Strategies Part 1: Recreate, Rolling Update, Blue-Green', '43MGkzT5bYQ', 'video'],
  ['Kubernetes Deployment Strategies Part 2: Canary, A/B Routing, Shadow Traffic', 'Wx9RfYuO3WY', 'video'],
  ['MLOps #4: Observability and Drift Detection', 'g79F3WLZKSQ', 'live'],
  ['Prometheus & Grafana Monitoring Stack: Architecture, Metrics & PromQL (Part 1)', 'n9iphdrNfr8', 'video'],
  ['MLOps Practitioner Course: Final project submission', 's2TxWGGYHbQ', 'video'],
];

const lesson = (order: number): RecordingDto => ({
  ...recording('x'),
  id: `course:mlops-practitioner:${order}`,
  kind: 'course',
  path: '/courses/mlops-practitioner',
  course: { slug: 'mlops-practitioner', titleEn: 'The MLOps Practitioner', titleAr: 'The MLOps Practitioner', order },
  speakers: [],
});

describe('the MLOps Engineer path', () => {
  const path = findPath('mlops-engineer')!;

  it("follows the owner's order, with Live/Video badges and nothing excluded", () => {
    expect(path.steps.map((s) => [s.title?.en, s.youtube?.split('v=')[1], s.format])).toEqual(MLOPS_ENGINEER_ORDER);
    const slugs = path.steps.flatMap((s) => (s.kind === 'recording' ? [s.slug] : []));
    for (const gone of ['introduction-to-llm-inference-engines', 'uv-for-legacy-python-projects', 'ruff-python-linting-formatting-ci', 'redis-for-semantic-caching']) {
      expect(slugs).not.toContain(gone);
    }
    expect(path.steps.some((s) => /model optimization|devops to mlops|#5/i.test(s.title?.en ?? ''))).toBe(false);
  });

  it('links only public slides and code: no invites, forms or spreadsheets', () => {
    for (const l of path.steps.flatMap((s) => s.links ?? [])) {
      expect(l.url).toMatch(/^https:\/\/(docs\.google\.com\/presentation\/|drive\.google\.com\/file\/|github\.com\/)/);
    }
    for (const s of path.steps) {
      expect(s.description?.en, s.title?.en).toBeTruthy();
      expect(s.description?.ar, s.title?.en).toBeTruthy();
    }
  });

  it('links each step to its page on the academy when there is one, else to YouTube', () => {
    const sp = (slug: string, name: string) => ({ slug, name, nameAr: null, titleEn: null, titleAr: null, photoUrl: null });
    const speakersBySession: Record<string, ReturnType<typeof sp>[]> = {
      'docker-deep-dive': [sp('mahmoud-sharif', 'Mahmoud Sharif')],
      // A renamed speaker: the path shows the current name from the speaker record.
      'hands-on-cicd-github-actions': [sp('abdallah-almalawany', 'Abdallah Elmalawany'), sp('aya-nasser-salama', 'Layla Member Salama')],
      'hands-on-fastapi-backend-for-mlops': [sp('mohamed-samy', 'Mohamed Samy')],
    };
    const recs = ['docker-deep-dive', 'hands-on-cicd-github-actions', 'kubernetes-deployment-strategies-part-1', 'kubernetes-deployment-strategies-part-2', 'hands-on-fastapi-backend-for-mlops', 'prometheus-grafana-monitoring-stack-part-1'].map((slug) => ({
      ...recording(slug),
      speakers: speakersBySession[slug] ?? [],
    }));
    const steps = resolveSteps(path, [], [...recs, lesson(1), lesson(2), lesson(3), lesson(4)], 'en');
    expect(steps.map((s) => s.path)).toEqual([
      'https://www.youtube.com/watch?v=n0dv6KZHq9M',
      '/courses/mlops-practitioner#lesson-1',
      '/sessions/hands-on-fastapi-backend-for-mlops',
      '/sessions/docker-deep-dive',
      '/courses/mlops-practitioner#lesson-2',
      '/sessions/hands-on-cicd-github-actions',
      '/courses/mlops-practitioner#lesson-3',
      '/sessions/kubernetes-deployment-strategies-part-1',
      '/sessions/kubernetes-deployment-strategies-part-2',
      '/courses/mlops-practitioner#lesson-4',
      '/sessions/prometheus-grafana-monitoring-stack-part-1',
      'https://www.youtube.com/watch?v=s2TxWGGYHbQ',
    ]);
    expect(steps.map((s) => s.title)).toEqual(MLOPS_ENGINEER_ORDER.map(([t]) => t));
    expect(steps[1]).toMatchObject({ kind: 'lesson', people: ['Layla Member Salama'], format: 'live' });
    expect(steps[1]!.speakers).toEqual([{ slug: 'aya-nasser-salama', name: 'Layla Member Salama' }]);
    expect(steps[5]!.speakers).toEqual([{ slug: 'abdallah-almalawany', name: 'Abdallah Elmalawany' }]);
    expect(steps[7]!.people).toEqual([]);
    // The order isn't chronological: no dates at all.
    expect(steps.every((s) => s.date === null)).toBe(true);
    // Prometheus has no speaker in the archive: the path names him by slug, resolved from the API's records.
    expect(steps[10]!.speakers).toEqual([{ slug: 'mahmoud-sharif', name: 'Mahmoud Sharif' }]);

    // Nothing on the site yet (API down at build, archive not imported): all 12 still show, on YouTube.
    const bare = resolveSteps(path, [], [], 'ar');
    expect(bare).toHaveLength(12);
    expect(bare.every((s) => s.external && s.kind === 'video')).toBe(true);
    // Without the API's speaker records nobody is named (never a hardcoded, possibly stale name).
    expect(bare.every((s) => s.people.length === 0)).toBe(true);
    expect(new Set(bare.map((s) => s.slug)).size).toBe(12);
  });

  it('has no course steps, so it shows no personal progress (lessons and videos are not tracked)', () => {
    expect(path.steps.some((s) => s.kind === 'course')).toBe(false);
  });
});
