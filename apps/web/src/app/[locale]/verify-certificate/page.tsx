import { certificatePath, normalizeCertificateCode } from '@academy/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { CertificateVerifier } from '@/components/certificates/CertificateVerifier';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ code?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('certificates.verifier.metaTitle'),
    description: t('certificates.verifier.metaDescription'),
    alternates: { canonical: absoluteUrl(`/${locale}/verify-certificate`) },
  };
}

/**
 * Verify a certificate: type its ID or scan its QR code. A ?code= (old links, the website's
 * verify tool redirecting here) opens the result straight away.
 */
export default async function VerifyCertificatePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const raw = (await searchParams).code;
  const code = normalizeCertificateCode(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''));
  if (code) redirect(certificatePath(locale, code));
  const t = createTranslator(locale);

  return (
    <div className="bg-muted-bg">
      <Container className="flex justify-center py-8 sm:py-14">
        <article className="flex w-full max-w-2xl flex-col gap-6 rounded-card border border-line bg-card p-5 shadow-sm sm:p-9">
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="" width={72} height={40} className="h-9 w-auto" priority />
            <p className="font-semibold text-primary">{t('certificates.verify.academy')}</p>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-[1.75rem] leading-tight sm:text-[2.25rem]">{t('certificates.verifier.title')}</h1>
            <p className="text-body">{t('certificates.verifier.intro')}</p>
          </div>
          <CertificateVerifier />
        </article>
      </Container>
    </div>
  );
}
