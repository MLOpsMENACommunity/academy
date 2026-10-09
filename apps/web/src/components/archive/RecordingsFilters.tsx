'use client';

import { recordingsQuerySchema, type RecordingSearchDto, type RecordingsDto } from '@academy/shared';
import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
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
 * library, throttled per IP). The filters
 * live in the URL but are read after hydration: the server HTML never depends on them.
 */
export interface RecordingFacets {
  id: string;
  topics: string[];
}

type Query = { topic?: string; q?: string };

function readUrl(): Query {
  const p = new URLSearchParams(window.location.search);
  const parsed = recordingsQuerySchema.safeParse({ topic: p.get('topic') ?? undefined, q: p.get('q') ?? undefined });
  return parsed.success ? { topic: parsed.data.topic, q: parsed.data.q || undefined } : {};
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

  useEffect(() => {
    const sync = () => setQuery(readUrl());
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

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
        : new Set(items.filter((i) => (!query.topic || i.topics.includes(query.topic)) && (!textIds || textIds.has(i.id))).map((i) => i.id));
    return {
      query,
      visible,
      count: visible ? visible.size : items.length,
      apply: (next) => {
        setQuery(next);
        const p = new URLSearchParams();
        if (next.topic) p.set('topic', next.topic);
        if (next.q) p.set('q', next.q);
        const qs = p.toString();
        window.history.pushState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
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
    apply({ topic: query.topic, q: (parsed.success && parsed.data) || undefined });
  }

  return (
    <form method="get" onSubmit={onSubmit} role="search" aria-label={t('sessions.search')} className="flex max-w-xl gap-2">
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

const chipClass =
  'inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-[0.9375rem] transition-colors aria-[current=true]:border-primary aria-[current=true]:bg-primary-soft aria-[current=true]:font-medium aria-[current=true]:text-primary border-line bg-card text-body hover:border-line-strong/60';

export function TopicChips({ topics }: { topics: RecordingsDto['topics'] }) {
  const { locale, t } = useI18n();
  const { query, apply } = useRecordings();
  const base = `/${locale}/sessions/recordings`;
  const chip = (topic: string | undefined, label: ReactNode) => {
    const p = new URLSearchParams();
    if (topic) p.set('topic', topic);
    if (query.q) p.set('q', query.q);
    const qs = p.toString();
    const onClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      apply({ topic, q: query.q });
    };
    return (
      <a href={qs ? `${base}?${qs}` : base} onClick={onClick} aria-current={query.topic === topic ? 'true' : undefined} className={chipClass}>
        {label}
      </a>
    );
  };
  return (
    <nav aria-label={t('sessions.topics')} className="mt-6">
      {/* Phones: one row that scrolls sideways (inside its own box, never the page). Wider screens wrap. */}
      <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>li]:shrink-0">
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

/** The count, the empty state, and the list (dimmed while a search is loading). */
export function RecordingsResults({ total, children }: { total: number; children: ReactNode }) {
  const { t, locale } = useI18n();
  const { query, visible, count, apply } = useRecordings();
  const loading = visible === null;
  const filtered = Boolean(query.topic || query.q);
  return (
    <>
      <p className="mt-8 text-[0.9375rem] text-muted" aria-live="polite">
        {loading ? ' ' : count === 1 ? t('sessions.recordingsCountOne') : t('sessions.recordingsCount', { count })}
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
