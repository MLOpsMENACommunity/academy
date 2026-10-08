'use client';

import { computeCompleteness, PROFILE_SECTIONS, type MeResponse, type ProfileDto } from '@academy/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AccountPanel } from '@/components/profile/AccountPanel';
import { SectionForm } from '@/components/profile/SectionForm';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Container';
import { Progress } from '@/components/ui/Progress';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

const TABS = [...PROFILE_SECTIONS, 'account'] as const;
type Tab = (typeof TABS)[number];

export function ProfilePage() {
  return <RequireAuth>{(user) => <Tabs user={user} />}</RequireAuth>;
}

function Tabs({ user }: { user: MeResponse }) {
  const { locale, t } = useI18n();
  const { reload } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const initial = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'core';
  const [tab, setTab] = useState<Tab>(initial);
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api<ProfileDto>('/me/profile').then(setProfile).catch(() => setLoadError(true));
  }, []);

  const select = (next: Tab, focus = false) => {
    setTab(next);
    router.replace(`/${locale}/profile?tab=${next}`, { scroll: false });
    if (focus) refs.current[next]?.focus();
  };

  // Arrow-key navigation per the WAI-ARIA tabs pattern (mirrored in RTL).
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const forward = locale === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    const backward = locale === 'ar' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward) select(TABS[(i + 1) % TABS.length]!, true);
    else if (e.key === backward) select(TABS[(i - 1 + TABS.length) % TABS.length]!, true);
    else return;
    e.preventDefault();
  };

  if (loadError) {
    return (
      <Container className="py-12">
        <Alert tone="danger">{t('errors.generic')}</Alert>
      </Container>
    );
  }
  if (!profile) return <PageSpinner />;
  const completeness = computeCompleteness(profile);

  return (
    <Container className="max-w-4xl py-10">
      <h1 className="text-3xl">{t('profile.title')}</h1>
      <div className="mt-6 grid gap-3 rounded-card border border-line bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <Progress value={profile.completeness} label={t('profile.completeness', { percent: profile.completeness })} />
        {profile.updatedAt && (
          <p className="text-sm text-muted">{t('profile.lastUpdated', { date: formatDate(profile.updatedAt, locale) })}</p>
        )}
      </div>
      {!completeness.coreComplete && (
        <Alert tone="warning" className="mt-4">
          {t('profile.coreMissing')}
        </Alert>
      )}

      <div
        role="tablist"
        aria-label={t('profile.title')}
        className="-mx-4 mt-8 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0"
        onKeyDown={onKey}
      >
        {TABS.map((s) => (
          <button
            key={s}
            ref={(el) => {
              refs.current[s] = el;
            }}
            role="tab"
            id={`tab-${s}`}
            aria-selected={tab === s}
            aria-controls={`panel-${s}`}
            tabIndex={tab === s ? 0 : -1}
            onClick={() => select(s)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${
              tab === s ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t(`profile.sections.${s}`)}
            {s !== 'account' && completeness.incompleteSections.includes(s) && (
              <span className="ms-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" aria-hidden />
            )}
            {s === 'core' && !completeness.coreComplete && (
              <span className="ms-1.5 inline-block size-1.5 rounded-full bg-danger align-middle" aria-hidden />
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6" tabIndex={0}>
        {tab === 'account' ? (
          <AccountPanel user={user} />
        ) : (
          <div className="rounded-card border border-line bg-card p-5 sm:p-8">
            <p className="mb-6 text-sm text-muted">{t(`profile.sectionHints.${tab}`)}</p>
            <SectionForm
              key={tab}
              section={tab}
              profile={profile}
              onSaved={(p) => {
                setProfile(p);
                if (p.coreComplete !== profile.coreComplete) void reload();
              }}
            />
          </div>
        )}
      </div>
    </Container>
  );
}
