'use client';

import {
  catalogQuerySchema,
  COURSE_LANGUAGES,
  COURSE_LEVELS,
  courseAvailabilityLabels,
  courseLanguageLabels,
  courseLevelLabels,
  courseTypeLabels,
  type CatalogQuery,
  type CourseSummaryDto,
  type Localized,
} from '@academy/shared';
import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/input';
import { useI18n } from '@/i18n/client';

/**
 * Catalog filters, applied in the browser.
 *
 * The catalog page is static (ISR + edge cache): its HTML always lists every public
 * course, and the filters only hide cards. The whole catalog is a few dozen courses, and
 * these four facets are fields of each summary, so filtering here gives the same result
 * as the API's ?level=&type=&language=&availability= did. The filters live in the URL
 * (shareable, back button) but are read after hydration, so the server HTML never
 * depends on the query string.
 */
export type CourseFacets = Pick<CourseSummaryDto, 'id' | 'level' | 'type' | 'language' | 'availability'>;

const KEYS = ['availability', 'type', 'level', 'language'] as const;

function readUrl(): CatalogQuery {
  const raw = Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([k, v]) => (KEYS as readonly string[]).includes(k) && v));
  const parsed = catalogQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function matches(c: CourseFacets, q: CatalogQuery): boolean {
  return KEYS.every((k) => !q[k] || c[k] === q[k]);
}

const Ctx = createContext<{ q: CatalogQuery; apply: (q: CatalogQuery) => void; courses: CourseFacets[] } | null>(null);
function useCatalog() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCatalog must be used inside CatalogProvider');
  return ctx;
}

export function CatalogProvider({ courses, children }: { courses: CourseFacets[]; children: ReactNode }) {
  const [q, setQ] = useState<CatalogQuery>({});
  useEffect(() => {
    const sync = () => setQ(readUrl());
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const value = useMemo(
    () => ({
      q,
      courses,
      apply: (next: CatalogQuery) => {
        setQ(next);
        const qs = new URLSearchParams(KEYS.flatMap((k) => (next[k] ? [[k, next[k]]] : []))).toString();
        // Same page, new filters: no request to the server (Next keeps its router in sync with pushState).
        window.history.pushState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      },
    }),
    [q, courses],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function CatalogForm() {
  const { locale, t } = useI18n();
  const { q, apply } = useCatalog();
  const [draft, setDraft] = useState<CatalogQuery>(q);
  useEffect(() => setDraft(q), [q]);
  const filtered = KEYS.some((k) => q[k]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    apply(draft);
  }

  const select = (name: (typeof KEYS)[number], label: string, values: readonly string[], labels: Record<string, Localized>) => (
    <label className="block min-w-0 text-sm">
      <span className="mb-1.5 block font-medium text-fg">{label}</span>
      <select
        name={name}
        value={draft[name] ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value || undefined }))}
        className={inputClass}
      >
        <option value="">{t('catalog.any')}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v]?.[locale] ?? v}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    // method="get" still works before hydration: the filters land in the URL and apply on load.
    <form method="get" onSubmit={onSubmit} className="mt-8" aria-label={t('catalog.filters')}>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
        {select('availability', t('catalog.status'), ['OPEN', 'UPCOMING', 'CLOSED'], courseAvailabilityLabels)}
        {select('type', t('catalog.price'), ['FREE', 'PAID'], courseTypeLabels)}
        {select('level', t('catalog.level'), COURSE_LEVELS, courseLevelLabels)}
        {select('language', t('catalog.language'), COURSE_LANGUAGES, courseLanguageLabels)}
        <div className="col-span-2 flex flex-wrap gap-2 lg:col-span-1">
          <button type="submit" className={buttonClass('primary', 'md')}>
            {t('catalog.apply')}
          </button>
          {filtered && (
            <a
              href={`/${locale}/courses`}
              onClick={(e) => {
                e.preventDefault();
                apply({});
              }}
              className={buttonClass('ghost', 'md')}
            >
              {t('catalog.reset')}
            </a>
          )}
        </div>
      </div>
    </form>
  );
}

/** "N courses" and, when nothing matches, the empty state. */
export function CatalogCount() {
  const { t } = useI18n();
  const { q, courses } = useCatalog();
  const count = courses.filter((c) => matches(c, q)).length;
  const filtered = KEYS.some((k) => q[k]);
  return (
    <>
      <p className="text-[0.9375rem] text-muted" role="status">
        {t('catalog.results', { count })}
      </p>
      {count === 0 && (
        <p className="mt-5 rounded-card border border-dashed border-line-strong/50 p-10 text-center text-muted">
          {filtered ? t('catalog.empty') : t('catalog.emptyAll')}
        </p>
      )}
    </>
  );
}

/** One server-rendered course card, hidden when the filters exclude it. */
export function CatalogItem({ course, children }: { course: CourseFacets; children: ReactNode }) {
  const { q } = useCatalog();
  if (!matches(course, q)) return null;
  return <li className="flex">{children}</li>;
}
