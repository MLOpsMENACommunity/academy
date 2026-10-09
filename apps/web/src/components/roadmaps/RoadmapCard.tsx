import type { Locale } from '@academy/shared';
import { CatalogCard } from '@/components/catalog/CatalogCard';
import { createTranslator } from '@/i18n/translator';
import type { RoadmapMeta } from '@/lib/roadmaps';
import { accentStyle } from './accent';

/** An open-source roadmap in a catalog grid (home tabs, "other roadmaps"). Pass it already localized. */
export function RoadmapCard({ roadmap: r, locale, headingLevel = 'h3' }: { roadmap: RoadmapMeta; locale: Locale; headingLevel?: 'h2' | 'h3' }) {
  const t = createTranslator(locale);
  const a = accentStyle[r.accent];
  return (
    <CatalogCard
      href={`/${locale}/roadmaps/${r.slug}`}
      title={r.title}
      headingLevel={headingLevel}
      bar={a.bar}
      badge={{ tone: a.tone, label: r.level }}
      description={r.tagline}
      meta={[`${r.duration} · ${r.commitment}`, `${t('roadmaps.resources', { count: r.resourceCount })} · ${t('roadmaps.phases', { count: r.phases.length })}`]}
      cta={t('roadmaps.open')}
    />
  );
}
