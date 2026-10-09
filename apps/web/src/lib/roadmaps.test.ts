import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ROADMAPS_AR } from '@/content/roadmaps-ar';
import { createTranslator } from '@/i18n/translator';
import { getRoadmap, getRoadmaps, localizeRoadmap, phaseLabel, websiteRoadmapUrl } from './roadmaps';

// The real module refuses to load outside a React Server Components bundle.
vi.mock('server-only', () => ({}));

/**
 * What mlopsmena.com shows for the same files (its src/lib/roadmaps.ts): the number of
 * "## Phase n — …" / "## Specialization n — …" headings and of "- [link](…)" bullets.
 * If a sync changes these, the website changed too: update them together.
 */
const WEBSITE = {
  'basic-mlops-engineer': { phases: 5, resources: 51, first: { label: 'Phase 0', title: 'Foundations', when: 'Month 1-2' } },
  'devops-to-mlops': { phases: 5, resources: 31, first: { label: 'Phase 1', title: 'Fill the Python & ML Gap', when: 'Month 1' } },
  'senior-mlops-engineer': { phases: 7, resources: 85, first: { label: 'Specialization 1', title: 'LLMOps', when: '' } },
};

describe('open-source roadmaps', () => {
  it('parses the three roadmaps in the website order, with its phases and resource counts', () => {
    const roadmaps = getRoadmaps();
    expect(roadmaps.map((r) => r.slug)).toEqual(Object.keys(WEBSITE));
    for (const r of roadmaps) {
      const expected = WEBSITE[r.slug as keyof typeof WEBSITE];
      expect(r.phases).toHaveLength(expected.phases);
      expect(r.resourceCount).toBe(expected.resources);
      expect(r.phases[0]).toMatchObject(expected.first);
      expect(r.title && r.tagline && r.level && r.duration && r.commitment && r.audience).toBeTruthy();
      expect(r.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.sourceUrl).toMatch(/^https:\/\/www\.linkedin\.com\/pulse\//);
      expect(['cyan', 'amber', 'violet']).toContain(r.accent);
    }
  });

  it('renders the body with heading anchors for every phase and external links in a new tab', () => {
    const r = getRoadmap('basic-mlops-engineer')!;
    for (const p of r.phases) expect(r.html).toContain(`<h2 id="${p.id}">`);
    // github-slugger, as on the website: the em dash goes, its two spaces become two hyphens.
    expect(r.phases[0]!.id).toBe('phase-0--foundations-month-1-2');
    const links = r.html.match(/<a href="https?:[^"]*"[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(r.resourceCount);
    for (const a of links) expect(a).toContain('target="_blank" rel="noopener noreferrer"');
    // GFM: the DevOps roadmap's skills table is a real table.
    expect(getRoadmap('devops-to-mlops')!.html).toContain('<table>');
  });

  it('returns null for an unknown slug', () => {
    expect(getRoadmap('nope')).toBeNull();
  });

  it('has an Arabic overview for every roadmap and phase, and keeps the body, anchors and dates English', () => {
    for (const r of getRoadmaps()) {
      const ar = ROADMAPS_AR[r.slug];
      expect(ar, r.slug).toBeDefined();
      expect(Object.keys(ar!.phases).sort()).toEqual(r.phases.map((p) => p.label).sort());
      const l = localizeRoadmap(r, 'ar');
      expect(l.title).toBe(ar!.title);
      expect(l.phases.map((p) => p.id)).toEqual(r.phases.map((p) => p.id));
      expect(l.phases.map((p) => p.when)).toEqual(r.phases.map((p) => p.when));
      expect(localizeRoadmap(r, 'en')).toEqual(r);
    }
    const full = getRoadmap('senior-mlops-engineer')!;
    expect(localizeRoadmap(full, 'ar').html).toBe(full.html);
  });

  it('labels phases in the reader’s language', () => {
    expect(phaseLabel(createTranslator('en'), 'Phase 0')).toBe('Phase 0');
    expect(phaseLabel(createTranslator('ar'), 'Phase 2')).toBe('المرحلة 2');
    expect(phaseLabel(createTranslator('ar'), 'Specialization 3')).toBe('التخصّص 3');
  });

  it('points the canonical at the original on mlopsmena.com', () => {
    expect(websiteRoadmapUrl('devops-to-mlops', 'en')).toBe('https://mlopsmena.com/roadmaps/devops-to-mlops/');
    expect(websiteRoadmapUrl('devops-to-mlops', 'ar')).toBe('https://mlopsmena.com/ar/roadmaps/devops-to-mlops/');
  });
});

describe('roadmap pages', () => {
  it('prerender every roadmap, and 404 an unknown slug', async () => {
    const page = await import('@/app/[locale]/roadmaps/[slug]/page');
    expect(page.generateStaticParams()).toEqual(getRoadmaps().map((r) => ({ slug: r.slug })));
    await expect(page.default({ params: Promise.resolve({ locale: 'en', slug: 'nope' }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it('render in Arabic with the English body in a left-to-right block, without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { default: Page, generateMetadata } = await import('@/app/[locale]/roadmaps/[slug]/page');
    const params = Promise.resolve({ locale: 'ar', slug: 'devops-to-mlops' });
    const html = renderToStaticMarkup(await Page({ params }));
    expect(html).toContain('خريطة الانتقال من DevOps إلى MLOps');
    expect(html).toContain('<article dir="ltr" lang="en"');
    // A roadmap, not an article: no link out to the LinkedIn post, only a quiet "first published" line.
    expect(html).not.toContain('linkedin.com/pulse');
    expect(html).toContain('نشرها MLOps MENA لأول مرة في');
    expect(html).toContain('href="#phase-1--fill-the-python--ml-gap-month-1"');
    const meta = await generateMetadata({ params });
    expect(meta.alternates?.canonical).toBe('https://mlopsmena.com/ar/roadmaps/devops-to-mlops/');

    const index = await import('@/app/[locale]/roadmaps/page');
    const list = renderToStaticMarkup(await index.default({ params: Promise.resolve({ locale: 'en' }) }));
    expect(list).toContain('Open-source roadmaps');
    for (const r of getRoadmaps()) expect(list).toContain(`href="/en/roadmaps/${r.slug}"`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
