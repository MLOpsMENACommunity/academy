'use client';

import { courseLanguageLabels, type CourseDetailDto, type Locale } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { ApplyCta } from './ApplyCta';
import { priceLabel } from './CourseCard';
import { Markdown } from './Markdown';

const pick = (locale: Locale, en: string, ar: string | null | undefined) => (locale === 'ar' && ar ? ar : en);

type State = { kind: 'loading' } | { kind: 'ok'; course: CourseDetailDto } | { kind: 'hidden' } | { kind: 'error' };

/**
 * A private course (shared with specific accounts only). The cached, public page knows only that
 * a private course lives at this address; the course itself is fetched here with the visitor's
 * session, and the API answers only accounts on the course's list (404 for everyone else).
 */
export function PrivateCourse({ slug }: { slug: string }) {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    // no-store: an answer from before signing in (a 404) must never be reused.
    api<CourseDetailDto>(`/courses/${slug}`, { cache: 'no-store' })
      .then((course) => !cancelled && setState({ kind: 'ok', course }))
      .catch((err) => !cancelled && setState({ kind: err instanceof ApiError && err.status === 404 ? 'hidden' : 'error' }));
    return () => {
      cancelled = true;
    };
  }, [slug, user, loading]);

  const here = `/${locale}/courses/${slug}`;

  if (loading || (user && state.kind === 'loading')) {
    return (
      <div aria-label={t('privateCourse.loading')}>
        <PageSpinner />
      </div>
    );
  }

  if (!user || state.kind === 'hidden' || state.kind === 'error') {
    const signIn = !user;
    return (
      <Container className="max-w-2xl py-16">
        <Badge tone="info">{t('privateCourse.badge')}</Badge>
        <h1 className="mt-3 text-3xl">{signIn ? t('privateCourse.signInTitle') : state.kind === 'error' ? t('privateCourse.badge') : t('privateCourse.notAvailableTitle')}</h1>
        {state.kind === 'error' && user ? (
          <Alert tone="danger" className="mt-4">
            {t('privateCourse.error')}
          </Alert>
        ) : (
          <p className="mt-3 leading-relaxed text-muted">{signIn ? t('privateCourse.signInBody') : t('privateCourse.notAvailableBody')}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {signIn && (
            <Link href={`/${locale}/login?returnTo=${encodeURIComponent(here)}`} className={buttonClass('accent', 'md')}>
              {t('privateCourse.signIn')}
            </Link>
          )}
          <Link href={`/${locale}/contact`} className={buttonClass('secondary', 'md')}>
            {t('privateCourse.contact')}
          </Link>
        </div>
      </Container>
    );
  }

  if (state.kind !== 'ok') return null;
  const c = state.course;
  const price = priceLabel(c, locale);
  const outcomes = c.learningOutcomes[locale] ?? [];
  const longDescription = pick(locale, c.longDescriptionEn, c.longDescriptionAr).trim();

  return (
    <Container className="max-w-3xl py-12">
      <Badge tone="info">{t('privateCourse.badge')}</Badge>
      <h1 className="mt-3 text-3xl sm:text-4xl">{pick(locale, c.titleEn, c.titleAr)}</h1>
      <p className="mt-3 text-lg leading-relaxed text-muted">{pick(locale, c.shortDescriptionEn, c.shortDescriptionAr)}</p>

      <div className="mt-6 rounded-card border border-line bg-card p-5">
        <p className="text-sm font-medium text-muted">{t('privateCourse.price')}</p>
        <p className="mt-1 text-3xl font-semibold text-fg">{price}</p>
        <p className="mt-1 text-sm text-muted">{courseLanguageLabels[c.language][locale]}</p>
        <div className="mt-4">
          <ApplyCta
            slug={c.slug}
            availability={c.availability}
            applicationDeadline={c.applicationDeadline}
            isFree={c.type === 'FREE'}
            requiresApproval={c.requiresApproval}
            full={c.seatsRemaining === 0}
            priceText={price}
            completed={c.completed}
          />
        </div>
      </div>

      {longDescription && (
        <section aria-labelledby="private-about" className="mt-10">
          <h2 id="private-about" className="text-2xl">
            {t('privateCourse.about')}
          </h2>
          <div className="mt-4">
            <Markdown>{longDescription}</Markdown>
          </div>
        </section>
      )}

      {outcomes.length > 0 && (
        <section aria-labelledby="private-outcomes" className="mt-10">
          <h2 id="private-outcomes" className="text-2xl">
            {t('course.outcomes')}
          </h2>
          <ul className="mt-4 list-disc space-y-2 ps-5">
            {outcomes.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      )}

      {c.outline.length > 0 && (
        <section aria-labelledby="private-syllabus" className="mt-10">
          <h2 id="private-syllabus" className="text-2xl">
            {t('course.syllabus')}
          </h2>
          <ol className="mt-4">
            {c.outline.map((m, i) => (
              <li key={i} className="border-t border-line py-4 last:border-b">
                <p className="text-sm font-medium text-primary">{t('course.module', { n: i + 1 })}</p>
                <h3 className="mt-1 text-[1.0625rem]">{pick(locale, m.titleEn, m.titleAr)}</h3>
                {(m.descriptionEn || m.descriptionAr) && <p className="mt-1.5 leading-relaxed text-muted">{pick(locale, m.descriptionEn ?? '', m.descriptionAr)}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {c.instructors.length > 0 && (
        <section aria-labelledby="private-instructors" className="mt-10">
          <h2 id="private-instructors" className="text-2xl">
            {c.instructors.length > 1 ? t('course.instructors') : t('course.instructor')}
          </h2>
          <ul className="mt-4 space-y-4">
            {c.instructors.map((i) => (
              <li key={i.id}>
                <p className="font-medium text-fg">{pick(locale, i.name, i.nameAr)}</p>
                {pick(locale, i.titleEn, i.titleAr) && <p className="text-sm text-muted">{pick(locale, i.titleEn, i.titleAr)}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Container>
  );
}
