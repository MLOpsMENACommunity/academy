'use client';

import { PROFILE_REVIEW_DAYS, type MeResponse } from '@academy/shared';
import Link from 'next/link';
import { MyCourses } from '@/components/applications/MyCourses';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { NextSessions } from '@/components/learn/NextSessions';
import { MySessionsList } from '@/components/sessions/MySessions';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { Progress } from '@/components/ui/Progress';
import { useI18n } from '@/i18n/client';

export function Dashboard() {
  return <RequireAuth>{(user) => <Home user={user} />}</RequireAuth>;
}

function Home({ user }: { user: MeResponse }) {
  const { locale, t } = useI18n();
  const stale =
    user.profile.updatedAt &&
    Date.now() - new Date(user.profile.updatedAt).getTime() > PROFILE_REVIEW_DAYS * 86_400_000;

  return (
    <Container className="py-10">
      <h1 className="text-3xl">{user.name ? t('dashboard.hello', { name: user.name.split(' ')[0]! }) : t('dashboard.helloAnon')}</h1>

      {stale && (
        <Alert tone="info" className="mt-6" title={t('profile.reviewPrompt')}>
          <Link href={`/${locale}/profile`} className="font-semibold underline">
            {t('profile.review')}
          </Link>
        </Alert>
      )}

      <section aria-labelledby="next" className="mt-8">
        <h2 id="next" className="text-xl">
          {t('dashboard.nextTitle')}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <NextSessions />
          {!user.profile.coreComplete && (
            <Card className="border-accent/40">
              <h3 className="text-lg">{t('dashboard.completeProfile')}</h3>
              <p className="mt-1 text-sm text-muted">{t('dashboard.completeProfileBody')}</p>
              <div className="mt-4">
                <Progress value={user.profile.completeness} label={t('profile.completeness', { percent: user.profile.completeness })} />
              </div>
              <Link href={`/${locale}/onboarding`} className={buttonClass('accent', 'md', 'mt-4')}>
                {t('dashboard.completeProfile')}
              </Link>
            </Card>
          )}
          {user.profile.coreComplete && user.profile.completeness < 100 && (
            <Card>
              <Progress value={user.profile.completeness} label={t('profile.completeness', { percent: user.profile.completeness })} />
              <Link href={`/${locale}/profile`} className={buttonClass('secondary', 'md', 'mt-4')}>
                {t('nav.profile')}
              </Link>
            </Card>
          )}
          <Card>
            <h3 className="text-lg">{t('dashboard.browse')}</h3>
            <p className="mt-1 text-sm text-muted">{t('dashboard.browseBody')}</p>
            <Link href={`/${locale}/courses`} className={buttonClass('primary', 'md', 'mt-4')}>
              {t('dashboard.browse')}
            </Link>
          </Card>
        </div>
      </section>

      <section aria-labelledby="my-courses" className="mt-10">
        <h2 id="my-courses" className="text-xl">
          {t('dashboard.myCourses')}
        </h2>
        <div className="mt-4">
          <MyCourses />
        </div>
      </section>

      <section aria-labelledby="my-sessions" className="mt-10">
        <h2 id="my-sessions" className="text-xl">
          {t('dashboard.mySessions')}
        </h2>
        <div className="mt-4">
          <MySessionsList />
        </div>
      </section>
    </Container>
  );
}
