import { whatsappUrl, type Locale, type PublicContactDto } from '@academy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Container';
import { policies, type PolicySlug } from '@/content/policies';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates } from '@/lib/seo';
import { serverGetOr } from '@/lib/server-api';
import { community } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

const NO_CONTACT: PublicContactDto = { supportEmail: '', supportWhatsapp: '' };
const linkClass = 'font-medium text-primary underline underline-offset-4';

export function policyMetadata(slug: PolicySlug) {
  return async ({ params }: Props): Promise<Metadata> => {
    const { locale } = await params;
    if (!isLocale(locale)) return {};
    const p = policies[slug][locale];
    return { title: p.title, description: p.description, alternates: alternates(locale, `/${slug}`) };
  };
}

/** Community channels: the always-working way to reach the team. */
const COMMUNITY_LINKS = [
  ['Discord', community.discord],
  ['Telegram', community.telegram],
  ['LinkedIn', community.linkedin],
  ['YouTube', community.youtube],
] as const;

/**
 * "{contact}" becomes the support email (Admin → Settings) when one is set; otherwise a
 * link to the contact page (or, on the contact page itself, to the community channels).
 */
function withContact(text: string, contact: PublicContactDto, slug: PolicySlug, locale: Locale): ReactNode {
  if (!text.includes('{contact}')) return text;
  const t = createTranslator(locale);
  const [before, after] = text.split('{contact}');
  const node = contact.supportEmail ? (
    <a href={`mailto:${contact.supportEmail}`} className={`ltr-embed ${linkClass}`}>
      {contact.supportEmail}
    </a>
  ) : slug === 'contact' ? (
    <a href="#community" className={linkClass}>
      {t('policy.communityBelow')}
    </a>
  ) : (
    <Link href={`/${locale}/contact`} className={linkClass}>
      {t('policy.contactPage')}
    </Link>
  );
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}

export function policyPage(slug: PolicySlug) {
  return async function PolicyPage({ params }: Props) {
    const { locale } = await params;
    if (!isLocale(locale)) notFound();
    const t = createTranslator(locale);
    const p = policies[slug][locale];
    const contact = await serverGetOr<PublicContactDto>('/settings/public', NO_CONTACT);
    const isPlaceholder = JSON.stringify(p).includes('[PLACEHOLDER]');
    // The email section only exists once a real support inbox is set.
    const sections = p.sections.filter((s) => !s.needsEmail || contact.supportEmail);
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
          {sections.map((s) => (
            <section key={s.heading} id={s.communityLinks ? 'community' : undefined} className="scroll-mt-6">
              <h2>{s.heading}</h2>
              {s.body.map((para) => (
                <p key={para}>{withContact(para, contact, slug, locale)}</p>
              ))}
              {s.communityLinks && (
                <ul>
                  {COMMUNITY_LINKS.map(([name, href]) => (
                    <li key={name}>
                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
                        {name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {slug === 'contact' && contact.supportWhatsapp && (
            <section>
              <h2>WhatsApp</h2>
              <p>
                {t('policy.whatsapp')}{' '}
                <a href={whatsappUrl(contact.supportWhatsapp)} target="_blank" rel="noopener noreferrer" className={`ltr-embed ${linkClass}`}>
                  {contact.supportWhatsapp}
                </a>
              </p>
            </section>
          )}
        </div>
      </Container>
    );
  };
}
