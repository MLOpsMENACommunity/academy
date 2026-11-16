import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChallengeDetail } from '@/components/challenges/ChallengeDetail';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return { title: t('challenges.detailTitle'), description: t('challenges.intro'), alternates: alternates(locale, `/challenges/${slug}`) };
}

/** One challenge: the brief, and for a signed-in student their entry and the submit form (loaded in the browser). */
export default async function ChallengePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  return (
    <Container className="py-8 sm:py-12">
      <ChallengeDetail slug={slug} />
    </Container>
  );
}
