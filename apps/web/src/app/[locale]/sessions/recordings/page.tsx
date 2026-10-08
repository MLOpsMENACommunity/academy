import { recordingsQuerySchema, type RecordingsDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordingCard } from '@/components/archive/RecordingCard';
import { SessionsHeader } from '@/components/sessions/SessionsHeader';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { inputClass } from '@/components/ui/input';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { isoDuration, topicText, youtubeThumbnail } from '@/lib/archive';
import { jsonLd } from '@/lib/jsonld';
import { alternates } from '@/lib/seo';
import { serverGetOr } from '@/lib/server-api';
import { pick } from '@/lib/sessions';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  const filtered = Object.values(await searchParams).some(Boolean);
  return {
    title: t('sessions.recordingsTitle'),
    description: t('sessions.recordingsMeta'),
    alternates: alternates(locale, '/sessions/recordings'),
    openGraph: { title: t('sessions.recordingsTitle'), description: t('sessions.recordingsMeta') },
    // Filtered and searched views are the same recordings again: keep them out of search results.
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

const chipClass =
  'inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-[0.9375rem] transition-colors aria-[current=true]:border-primary aria-[current=true]:bg-primary-soft aria-[current=true]:font-medium aria-[current=true]:text-primary border-line bg-card text-body hover:border-line-strong/60';

export default async function RecordingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const raw = await searchParams;
  const parsed = recordingsQuerySchema.safeParse({
    topic: typeof raw.topic === 'string' ? raw.topic : undefined,
    q: typeof raw.q === 'string' ? raw.q : undefined,
  });
  const q = parsed.success ? parsed.data : {};
  const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const [all, data] = await Promise.all([
    // The chips come from the whole library, so they stay put while filtering.
    serverGetOr<RecordingsDto>('/recordings', { items: [], topics: [] }),
    qs ? serverGetOr<RecordingsDto>(`/recordings?${qs}`, { items: [], topics: [] }) : null,
  ]);
  const items = (data ?? all).items;
  const base = `/${locale}/sessions/recordings`;
  const href = (topic?: string) => {
    const p = new URLSearchParams();
    if (topic) p.set('topic', topic);
    if (q.q) p.set('q', q.q);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  const structured = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('sessions.recordingsTitle'),
    itemListElement: items
      .filter((r) => r.youtubeId)
      .map((r, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'VideoObject',
          name: pick(locale, r.titleEn, r.titleAr),
          description: pick(locale, r.titleEn, r.titleAr),
          thumbnailUrl: youtubeThumbnail(r.youtubeId!),
          uploadDate: r.startsAt,
          duration: isoDuration(r.durationMin),
          embedUrl: `https://www.youtube-nocookie.com/embed/${r.youtubeId}`,
          url: absoluteUrl(`/${locale}${r.path}`),
        },
      })),
  };

  return (
    <>
      {items.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />}
      <SessionsHeader locale={locale} view="recordings" />

      <Container className="py-10 sm:py-14">
        <form method="get" action={base} role="search" aria-label={t('sessions.search')} className="flex max-w-xl gap-2">
          {q.topic && <input type="hidden" name="topic" value={q.topic} />}
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('sessions.search')}</span>
            <input type="search" name="q" defaultValue={q.q ?? ''} placeholder={t('sessions.searchPlaceholder')} maxLength={100} className={inputClass} />
          </label>
          <button type="submit" className={buttonClass('primary', 'lg', 'shrink-0')}>
            {t('sessions.searchButton')}
          </button>
        </form>

        {all.topics.length > 0 && (
          <nav aria-label={t('sessions.topics')} className="mt-6">
            {/* Phones: one row that scrolls sideways (inside its own box, never the page). Wider screens wrap. */}
            <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>li]:shrink-0">
              <li>
                <Link href={href()} aria-current={!q.topic ? 'true' : undefined} className={chipClass}>
                  {t('sessions.allTopics')}
                </Link>
              </li>
              {all.topics.map(({ tag, count }) => (
                <li key={tag}>
                  <Link href={href(tag)} aria-current={q.topic === tag ? 'true' : undefined} className={chipClass}>
                    {topicText(locale, tag)}
                    <span className="ms-1.5 text-sm text-muted">{count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <p className="mt-8 text-[0.9375rem] text-muted" aria-live="polite">
          {items.length === 1 ? t('sessions.recordingsCountOne') : t('sessions.recordingsCount', { count: items.length })}
        </p>

        {items.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-line-strong/50 px-6 py-12 text-center sm:py-16">
            <h2 className="text-xl sm:text-2xl">{t('sessions.noRecordings')}</h2>
            <p className="mx-auto mt-3 max-w-md leading-relaxed text-muted">{t('sessions.noRecordingsBody')}</p>
            {qs && (
              <Link href={base} className={buttonClass('secondary', 'md', 'mt-6')}>
                {t('sessions.clearFilters')}
              </Link>
            )}
          </div>
        ) : (
          <ul className="mt-4 grid gap-5 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <li key={r.id} className="flex min-w-0">
                <RecordingCard item={r} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
