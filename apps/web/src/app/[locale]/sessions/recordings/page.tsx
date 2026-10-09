import type { RecordingsDto } from '@academy/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RecordingCard } from '@/components/archive/RecordingCard';
import { RecordingsItem, RecordingsProvider, RecordingsResults, RecordingsSearch, TopicChips } from '@/components/archive/RecordingsFilters';
import { SessionsHeader } from '@/components/sessions/SessionsHeader';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { isoDuration, youtubeThumbnail } from '@/lib/archive';
import { jsonLd } from '@/lib/jsonld';
import { alternates } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { pick } from '@/lib/sessions';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

// Static (ISR): the same HTML for every visitor, so the edge can cache it. Topic and text
// filters run in the browser (RecordingsFilters), never through searchParams on the server.
export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('sessions.recordingsTitle'),
    description: t('sessions.recordingsMeta'),
    alternates: alternates(locale, '/sessions/recordings'),
    openGraph: { title: t('sessions.recordingsTitle'), description: t('sessions.recordingsMeta') },
    // Filtered and searched views (?topic=, ?q=) are the same page: the canonical above
    // points search engines at the unfiltered library.
  };
}

export default async function RecordingsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  // `topics` counts the whole library, so the chips stay put while filtering.
  // serverGet: an API failure fails the render instead of caching an empty library (see the catalog).
  const { items, topics } = (await serverGet<RecordingsDto>('/recordings')) ?? { items: [], topics: [] };

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
        <RecordingsProvider items={items.map(({ id, topics }) => ({ id, topics }))}>
          <RecordingsSearch />
          {topics.length > 0 && <TopicChips topics={topics} />}
          <RecordingsResults total={items.length}>
            {items.map((r) => (
              <RecordingsItem key={r.id} id={r.id}>
                <RecordingCard item={r} locale={locale} />
              </RecordingsItem>
            ))}
          </RecordingsResults>
        </RecordingsProvider>
      </Container>
    </>
  );
}
