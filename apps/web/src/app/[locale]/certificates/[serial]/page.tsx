import { certificatePath, type PublicCertificateDto } from '@academy/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { IconCheck } from '@/components/ui/Icons';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { formatDate } from '@/lib/format';
import { pick } from '@/lib/sessions';
import { absoluteUrl } from '@/lib/site';
import { lookupCertificate } from './data';

type Props = { params: Promise<{ locale: string; serial: string }> };

/**
 * Public verification page. Rendered on every request and never stored at the edge or in the
 * ISR cache (dynamic: Next sends `private, no-store`), so a revocation shows at once. The API
 * lookup is rate-limited per visitor IP; serials are unguessable.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, serial } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  const r = await lookupCertificate(serial);
  // Shared freely, but kept out of search results: these pages carry people's names.
  const robots = { index: false, follow: false };
  if (r.kind !== 'found' || r.cert.status === 'UNAVAILABLE') return { title: t('certificates.verify.metaTitle'), robots };
  const c = r.cert;
  const course = pick(locale, c.courseTitleEn, c.courseTitleAr);
  const name = locale === 'ar' ? c.nameAr || c.name : c.name;
  const title = t('certificates.verify.metaNamed', { name, course });
  const description = c.status === 'VALID' ? t('certificates.verify.metaDescription', { name, course }) : t('certificates.verify.revoked');
  return {
    title,
    description,
    robots,
    openGraph: { title, description, type: 'website', url: absoluteUrl(certificatePath(locale, c.serial)) },
  };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line py-3.5 sm:flex-row sm:gap-6">
      <dt className="text-sm text-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

export default async function CertificatePage({ params }: Props) {
  const { locale, serial } = await params;
  if (!isLocale(locale)) notFound();
  const r = await lookupCertificate(serial);
  if (r.kind === 'missing') notFound();
  const t = createTranslator(locale);

  const shell = (children: ReactNode) => (
    <div className="bg-muted-bg">
      <Container className="flex justify-center py-8 sm:py-14">
        <article className="flex w-full max-w-2xl flex-col gap-6 rounded-card border border-line bg-card p-5 shadow-sm sm:p-9">
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="" width={72} height={40} className="h-9 w-auto" priority />
            <div className="min-w-0">
              <p className="font-semibold text-primary">{t('certificates.verify.academy')}</p>
              <p className="text-sm text-muted">{t('certificates.verify.heading')}</p>
            </div>
          </div>
          {children}
        </article>
      </Container>
    </div>
  );

  if (r.kind === 'limited') return shell(<Alert tone="warning">{t('certificates.verify.limited')}</Alert>);
  const c = r.cert;
  if (c.status === 'UNAVAILABLE') {
    return shell(
      <Alert tone="info" title={t('certificates.verify.unavailable')}>
        {t('certificates.verify.unavailableBody')}
        <p className="mt-2 text-sm" dir="ltr">
          {c.serial}
        </p>
      </Alert>,
    );
  }
  const cert = c as Extract<PublicCertificateDto, { status: 'VALID' | 'REVOKED' }>;
  const valid = cert.status === 'VALID';
  const primaryName = locale === 'ar' && cert.nameAr ? cert.nameAr : cert.name;
  const otherName = locale === 'ar' ? (cert.nameAr ? cert.name : null) : cert.nameAr;
  const instructors = cert.instructors.map((i) => pick(locale, i.name, i.nameAr)).join(locale === 'ar' ? '، ' : ', ');

  return shell(
    <>
      {valid ? (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-success/25 bg-success-soft p-4 text-success">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success text-white">
            <IconCheck size={16} strokeWidth={3} />
          </span>
          <div>
            <p className="font-semibold">{t('certificates.verify.valid')}</p>
            <p className="text-sm">{t('certificates.verify.validBody')}</p>
          </div>
        </div>
      ) : (
        <Alert tone="danger" title={t('certificates.verify.revoked')}>
          {cert.revokedAt && t('certificates.verify.revokedOn', { date: formatDate(cert.revokedAt, locale) })} {t('certificates.verify.revokedBody')}
        </Alert>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">{t('certificates.verify.awardedTo')}</p>
        <h1 className={`text-[1.75rem] leading-tight sm:text-[2.25rem] ${valid ? '' : 'text-muted line-through decoration-1'}`}>{primaryName}</h1>
        {otherName && <p className="text-lg text-body">{otherName}</p>}
      </div>

      <dl>
        <Row label={t('certificates.verify.course')}>
          <Link href={`/${locale}/courses/${cert.courseSlug}`} className="font-medium text-primary hover:underline">
            {pick(locale, cert.courseTitleEn, cert.courseTitleAr)}
          </Link>
        </Row>
        <Row label={t('certificates.verify.issued')}>{formatDate(cert.issuedAt, locale)}</Row>
        {instructors && <Row label={t('certificates.verify.instructors')}>{instructors}</Row>}
        {cert.grade && <Row label={t('certificates.verify.grade')}>{cert.grade}</Row>}
        <Row label={t('certificates.verify.serial')}>
          <span dir="ltr" className="font-mono text-[0.9375rem]">
            {cert.serial}
          </span>
        </Row>
        <Row label={t('certificates.verify.issuer')}>{t('certificates.verify.issuerValue')}</Row>
      </dl>

      {valid && (
        <div className="flex flex-wrap gap-2">
          {/* A plain link: the public download needs no sign-in and is streamed by the API. */}
          <a href={`/api/certificates/${cert.serial}/pdf`} className={buttonClass('primary', 'md')} download>
            {t('certificates.download')}
          </a>
        </div>
      )}
    </>,
  );
}
