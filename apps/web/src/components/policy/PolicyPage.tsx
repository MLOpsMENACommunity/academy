import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Container';
import { policies, type PolicySlug } from '@/content/policies';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';

type Props = { params: Promise<{ locale: string }> };

export function policyMetadata(slug: PolicySlug) {
  return async ({ params }: Props): Promise<Metadata> => {
    const { locale } = await params;
    if (!isLocale(locale)) return {};
    const p = policies[slug][locale];
    return { title: p.title, description: p.description, alternates: alternates(locale, `/${slug}`) };
  };
}

export function policyPage(slug: PolicySlug) {
  return async function PolicyPage({ params }: Props) {
    const { locale } = await params;
    if (!isLocale(locale)) notFound();
    const t = createTranslator(locale);
    const p = policies[slug][locale];
    const isPlaceholder = JSON.stringify(p).includes('[PLACEHOLDER]');
    return (
      <Container className="max-w-3xl py-12">
        <h1 className="text-3xl">{p.title}</h1>
        {p.updated && <p className="mt-2 text-sm text-muted">{p.updated}</p>}
        {isPlaceholder && (
          <Alert tone="warning" className="mt-6">
            {t('common.placeholderNotice')}
          </Alert>
        )}
        <div className="prose-academy mt-8">
          {p.sections.map((s) => (
            <section key={s.heading}>
              <h2>{s.heading}</h2>
              {s.body.map((para) => (
                <p key={para}>{para}</p>
              ))}
            </section>
          ))}
        </div>
      </Container>
    );
  };
}
