'use client';

import {
  eventCategoryLabels,
  matchesRecording,
  recordingsQuerySchema,
  type EventCategory,
  type RecordingSearchDto,
  type RecordingsDto,
} from '@academy/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/input';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { topicText } from '@/lib/archive';

/**
 * Recordings library filters, applied in the browser.
 *
 * The page is static (ISR + edge cache) and its HTML lists the whole library; filters
 * only hide cards. A topic is a field of each item, so it filters here. The text search
 * also matches descriptions, which the page does not carry, so it asks the API which
 * items match (GET /recordings/search: ids only, from the API's in-memory copy of the
 * library, throttled per IP). The category (hands-on, from industry, course recordings, …)
 * filters here too, like the topic. The filters
 * live in the URL but are read after hydration: the server HTML never depends on them.
 */
export interface RecordingFacets {
  id: string;
  topics: string[];
  category: EventCategory | null;
}

type Query = { topic?: string; category?: EventCategory; q?: string };

function readUrl(): Query {
  const p = new URLSearchParams(window.location.search);
  const parsed = recordingsQuerySchema.safeParse({
    topic: p.get('topic') ?? undefined,
    category: p.get('category') ?? undefined,
    q: p.get('q') ?? undefined,
  });
  // An invalid value in one filter drops only that filter.
  if (parsed.success) return { topic: parsed.data.topic, category: parsed.data.category, q: parsed.data.q || undefined };
  const one = (k: 'topic' | 'category' | 'q') => {
    const r = recordingsQuerySchema.shape[k].safeParse(p.get(k) ?? undefined);
    return r.success ? r.data || undefined : undefined;
  };
  return { topic: one('topic') as string | undefined, category: one('category') as EventCategory | undefined, q: one('q') as string | undefined };
}

/** The page's address for these filters. */
export function recordingsHref(base: string, q: Query): string {
  const p = new URLSearchParams();
  if (q.category) p.set('category', q.category);
  if (q.topic) p.set('topic', q.topic);
  if (q.q) p.set('q', q.q);
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

interface State {
  query: Query;
  apply: (q: Query) => void;
  /** Ids matching the current filters; null while a text search is loading. */
  visible: Set<string> | null;
  count: number;
}
const Ctx = createContext<State | null>(null);
function useRecordings(): State {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRecordings must be used inside RecordingsProvider');
  return ctx;
}

export function RecordingsProvider({ items, children }: { items: RecordingFacets[]; children: ReactNode }) {
  const [query, setQuery] = useState<Query>({});
  /** Text-search result from the API, for `searched`. */
  const [found, setFound] = useState<{ key: string; ids: Set<string> } | null>(null);

  // Tags and categories in the library. One that isn't (a typo, an old link) is ignored
  // rather than showing "No recordings", and dropped from the address bar.
  const known = useMemo(() => new Set(items.flatMap((i) => i.topics)), [items]);
  const knownCategories = useMemo(() => new Set(items.map((i) => i.category)), [items]);
  useEffect(() => {
    const sync = () => {
      const raw = readUrl();
      const q: Query = {
        topic: raw.topic && known.has(raw.topic) ? raw.topic : undefined,
        category: raw.category && knownCategories.has(raw.category) ? raw.category : undefined,
        q: raw.q,
      };
      const href = recordingsHref(window.location.pathname, q);
      if (href !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(window.history.state, '', href);
      }
      setQuery(q);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [known, knownCategories]);

  const searchKey = query.q ? new URLSearchParams({ q: query.q }).toString() : '';
  useEffect(() => {
    if (!searchKey) return;
    let live = true;
    api<RecordingSearchDto>(`/recordings/search?${searchKey}`)
      .then((r) => live && setFound({ key: searchKey, ids: new Set(r.ids) }))
      // Search unavailable: show nothing rather than the unfiltered list as if it matched.
      .catch(() => live && setFound({ key: searchKey, ids: new Set() }));
    return () => {
      live = false;
    };
  }, [searchKey]);

  const value = useMemo<State>(() => {
    const textIds = searchKey ? (found?.key === searchKey ? found.ids : null) : undefined;
    const visible =
      textIds === null
        ? null
        : new Set(items.filter((i) => matchesRecording(i, query) && (!textIds || textIds.has(i.id))).map((i) => i.id));
    return {
      query,
      visible,
      count: visible ? visible.size : items.length,
      apply: (next) => {
        setQuery(next);
        window.history.pushState(null, '', recordingsHref(window.location.pathname, next));
      },
    };
  }, [items, query, searchKey, found]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RecordingsSearch() {
  const { t } = useI18n();
  const { query, apply } = useRecordings();
  const [text, setText] = useState(query.q ?? '');
  useEffect(() => setText(query.q ?? ''), [query.q]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = recordingsQuerySchema.shape.q.safeParse(text);
    apply({ ...query, q: (parsed.success && parsed.data) || undefined });
  }

  return (
    <form method="get" onSubmit={onSubmit} role="search" aria-label={t('sessions.search')} className="flex max-w-xl gap-2">
      {query.category && <input type="hidden" name="category" value={query.category} />}
      {query.topic && <input type="hidden" name="topic" value={query.topic} />}
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t('sessions.search')}</span>
        <input
          type="search"
          name="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('sessions.searchPlaceholder')}
          maxLength={100}
          className={inputClass}
        />
      </label>
      <button type="submit" className={buttonClass('primary', 'lg', 'shrink-0')}>
        {t('sessions.searchButton')}
      </button>
    </form>
  );
}

/**
 * On phones a chip row scrolls sideways: keep the selected chip in view (e.g. "From industry",
 * last in the Arabic row), without moving the page when the row is already on screen.
 */
function useSelectedChipInView(selected: string | undefined) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    const chip = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !chip || list.scrollWidth <= list.clientWidth) return;
    const l = list.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    // Scrolling by the difference works the same in LTR and RTL.
    if (c.left < l.left) list.scrollBy({ left: c.left - l.left - 20 });
    else if (c.right > l.right) list.scrollBy({ left: c.right - l.right + 20 });
  }, [selected]);
  return ref;
}

const chipClass =
  'inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-[0.9375rem] transition-colors aria-[current=true]:border-primary aria-[current=true]:bg-primary-soft aria-[current=true]:font-medium aria-[current=true]:text-primary border-line bg-card text-body hover:border-line-strong/60';

export function TopicChips({ topics }: { topics: RecordingsDto['topics'] }) {
  const { locale, t } = useI18n();
  const { query, apply } = useRecordings();
  const listRef = useSelectedChipInView(query.topic);
  const base = `/${locale}/sessions/recordings`;
  const chip = (topic: string | undefined, label: ReactNode) => {
    const next = { ...query, topic };
    const onClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      apply(next);
    };
    return (
      <a href={recordingsHref(base, next)} onClick={onClick} aria-current={query.topic === topic ? 'true' : undefined} className={chipClass}>
        {label}
      </a>
    );
  };
  return (
    <nav aria-label={t('sessions.topics')} className="mt-6">
      {/* Phones: one row that scrolls sideways (inside its own box, never the page). Wider screens wrap. */}
      <ul ref={listRef} className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>li]:shrink-0">
        <li>{chip(undefined, t('sessions.allTopics'))}</li>
        {topics.map(({ tag, count }) => (
          <li key={tag}>
            {chip(
              tag,
              <>
                {topicText(locale, tag)}
                <span className="ms-1.5 text-sm text-muted">{count}</span>
              </>,
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Hands-on sessions, talks from industry, course recordings, …: the library's shelves, as
 * links (they work before hydration and can be shared), the current one marked for screen readers.
 */
export function CategoryChips({ categories }: { categories: RecordingsDto['categories'] }) {
  const { locale, t } = useI18n();
  const { query, apply } = useRecordings();
  const listRef = useSelectedChipInView(query.category);
  const base = `/${locale}/sessions/recordings`;
  const chip = (category: EventCategory | undefined, label: ReactNode) => {
    const next = { ...query, category };
    const onClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      apply(next);
    };
    return (
      <a href={recordingsHref(base, next)} onClick={onClick} aria-current={query.category === category ? 'true' : undefined} className={chipClass}>
        {label}
      </a>
    );
  };
  return (
    <nav aria-label={t('sessions.categories')} className="mt-6">
      <ul ref={listRef} className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>li]:shrink-0">
        <li>{chip(undefined, t('sessions.allCategories'))}</li>
        {categories.map(({ category, count }) => (
          <li key={category}>
            {chip(
              category,
              <>
                {eventCategoryLabels[category][locale]}
                <span className="ms-1.5 text-sm text-muted">{count}</span>
              </>,
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The count, the empty state, and the list (dimmed while a search is loading). */
export function RecordingsResults({ total, children }: { total: number; children: ReactNode }) {
  const { t, locale } = useI18n();
  const { query, visible, count, apply } = useRecordings();
  const loading = visible === null;
  const filtered = Boolean(query.topic || query.category || query.q);
  return (
    <>
      <p className="mt-8 text-[0.9375rem] text-muted" aria-live="polite">
        {loading ? ' ' : t('sessions.recordingsCount', { count })}
      </p>
      {!loading && count === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-line-strong/50 px-6 py-12 text-center sm:py-16">
          <h2 className="text-xl sm:text-2xl">{t('sessions.noRecordings')}</h2>
          <p className="mx-auto mt-3 max-w-md leading-relaxed text-muted">{t('sessions.noRecordingsBody')}</p>
          {filtered && (
            <a
              href={`/${locale}/sessions/recordings`}
              onClick={(e) => {
                e.preventDefault();
                apply({});
              }}
              className={buttonClass('secondary', 'md', 'mt-6')}
            >
              {t('sessions.clearFilters')}
            </a>
          )}
        </div>
      ) : (
        total > 0 && (
          <ul aria-busy={loading || undefined} className={`mt-4 grid gap-5 transition-opacity sm:gap-6 md:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-50' : ''}`}>
            {children}
          </ul>
        )
      )}
    </>
  );
}

/** One server-rendered recording card, hidden when the filters exclude it. */
export function RecordingsItem({ id, children }: { id: string; children: ReactNode }) {
  const { visible } = useRecordings();
  if (visible && !visible.has(id)) return null;
  return <li className="flex min-w-0">{children}</li>;
}
