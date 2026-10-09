import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { ROADMAPS_AR } from '@/content/roadmaps-ar';
import type { Translate } from '@/i18n/translator';
import { community } from './site';

/**
 * The open-source roadmaps, read from src/content/roadmaps/*.md at build time.
 *
 * Those files are copies of the website's content/roadmaps/*.md (mlopsmena.com/roadmaps,
 * where they are written and first published), kept byte for byte by `pnpm roadmaps:sync`.
 * The parsing below is a port of the website's src/lib/roadmaps.ts, so both sites show
 * the same phases, resource counts and heading anchors.
 *
 * Pages only: never imported by client components (it reads the file system).
 */
const DIR = path.join(process.cwd(), 'src', 'content', 'roadmaps');

/** The website's accent per roadmap; mapped to the academy's logo tints in components/roadmaps. */
export type Accent = 'cyan' | 'amber' | 'violet';

export interface RoadmapPhase {
  /** "Phase 0", "Specialization 3": the English label, also used to look up translations. */
  label: string;
  title: string;
  /** "Month 1-2", or '' (the specializations have none). */
  when: string;
  /** The heading's anchor in the rendered body (rehype-slug). */
  id: string;
}

export interface RoadmapMeta {
  slug: string;
  title: string;
  tagline: string;
  accent: Accent;
  level: string;
  duration: string;
  commitment: string;
  /** ISO date (yyyy-mm-dd) of the original article. */
  published: string;
  /** The original LinkedIn article. */
  sourceUrl: string;
  audience: string;
  /** The "## Phase 0 — Foundations (Month 1-2)" headings, for the timeline strip and the contents. */
  phases: RoadmapPhase[];
  /** Bulleted links ("- [title](url)"), counted the way the website counts them. */
  resourceCount: number;
}

export interface Roadmap extends RoadmapMeta {
  html: string;
}

/** A hast node, narrowed to the little this file touches. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Sends every off-site link to a new tab (as the website does): a roadmap is a long
 * reading list, and following a link in the same tab loses the reader's place.
 */
function rehypeExternalLinks() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.tagName === 'a') {
        const href = node.properties?.href;
        if (typeof href === 'string' && /^https?:\/\//.test(href)) {
          node.properties = { ...node.properties, target: '_blank', rel: ['noopener', 'noreferrer'] };
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const text = (node: HastNode): string => node.value ?? (node.children ?? []).map(text).join('');

/** Collects the h2 headings' text and rehype-slug ids, so the timeline links to the real anchors. */
function rehypeCollectHeadings(into: { id: string; text: string }[]) {
  return () => (tree: HastNode) => {
    for (const node of tree.children ?? []) {
      if (node.tagName === 'h2' && typeof node.properties?.id === 'string') into.push({ id: node.properties.id, text: text(node).trim() });
    }
  };
}

/** Splits "Phase 0 — Foundations (Month 1-2)" into its three parts. */
function parseHeading(heading: string) {
  const m = heading.match(/^(Phase \d+|Specialization \d+)\s*—\s*(.+?)(?:\s*\(([^)]+)\))?$/);
  if (!m) return { label: heading, title: '', when: '' };
  return { label: m[1]!, title: m[2]!.trim(), when: m[3]?.trim() ?? '' };
}

const PHASE = /^(?:Phase|Specialization)\s+\d+/;

/** Ordered deliberately, as on the website: beginner → transition → senior. Unknown slugs sort last. */
const ORDER = ['basic-mlops-engineer', 'devops-to-mlops', 'senior-mlops-engineer'];
const rank = (slug: string) => {
  const i = ORDER.indexOf(slug);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

const str = (v: unknown) => (typeof v === 'string' ? v : v instanceof Date ? v.toISOString().slice(0, 10) : '');

function parse(slug: string): Roadmap {
  const { data, content } = matter(fs.readFileSync(path.join(DIR, `${slug}.md`), 'utf8'));
  const headings: { id: string; text: string }[] = [];
  const html = String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSlug)
      .use(rehypeExternalLinks)
      .use(rehypeCollectHeadings(headings))
      .use(rehypeStringify)
      .processSync(content),
  );
  const accent = str(data.accent);
  return {
    slug,
    title: str(data.title),
    tagline: str(data.tagline),
    accent: accent === 'amber' || accent === 'violet' ? accent : 'cyan',
    level: str(data.level),
    duration: str(data.duration),
    commitment: str(data.commitment),
    published: str(data.published),
    sourceUrl: str(data.sourceUrl),
    audience: str(data.audience),
    phases: headings.filter((h) => PHASE.test(h.text)).map((h) => ({ ...parseHeading(h.text), id: h.id })),
    resourceCount: (content.match(/^- \[/gm) ?? []).length,
    html,
  };
}

/** Parsed once per server process: the files only change with a new build. */
let cache: Roadmap[] | null = null;

function all(): Roadmap[] {
  if (!cache) {
    const slugs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
    cache = slugs.map(parse).sort((a, b) => rank(a.slug) - rank(b.slug));
  }
  return cache;
}

/** Every roadmap without its body (cards, menus, the sitemap). */
export function getRoadmaps(): RoadmapMeta[] {
  return all().map(({ html: _html, ...meta }) => meta);
}

export function getRoadmap(slug: string): Roadmap | null {
  return all().find((r) => r.slug === slug) ?? null;
}

/** The original article on mlopsmena.com, in the reader's language (the canonical URL). */
export function websiteRoadmapUrl(slug: string, locale: 'en' | 'ar'): string {
  return `${community.mainSite}${locale === 'ar' ? '/ar' : ''}/roadmaps/${slug}/`;
}

/**
 * The overview in the reader's language, as on the website: in Arabic the title,
 * tagline, level, duration, commitment, audience and phase names come from
 * content/roadmaps-ar.ts. The body (and each phase's `when`, label and anchor) stays English.
 */
export function localizeRoadmap<T extends RoadmapMeta>(r: T, locale: 'en' | 'ar'): T {
  const ar = locale === 'ar' ? ROADMAPS_AR[r.slug] : undefined;
  if (!ar) return r;
  return {
    ...r,
    title: ar.title,
    tagline: ar.tagline,
    level: ar.level,
    duration: ar.duration,
    commitment: ar.commitment,
    audience: ar.audience,
    phases: r.phases.map((p) => ({ ...p, title: ar.phases[p.label] ?? p.title })),
  };
}

/** "Phase 2" / "Specialization 3" in the reader's language ("المرحلة 2" / "التخصّص 3"). */
export function phaseLabel(t: Translate, label: string): string {
  const m = /^(Phase|Specialization)\s+(\d+)$/.exec(label);
  if (!m) return label;
  return t(m[1] === 'Phase' ? 'roadmaps.phaseN' : 'roadmaps.specializationN', { n: m[2]! });
}
