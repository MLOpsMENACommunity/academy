'use client';

import { CHALLENGE_NOTE_MAX, CHALLENGE_URL_MAX, challengeEntrySchema, type MyChallengeDto, type PublicChallengeDto } from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useHasSessionCookie } from '@/components/auth/SignedInForward';
import { Markdown } from '@/components/course/Markdown';
import { CheckboxField, TextAreaField, TextField } from '@/components/forms/fields';
import { BadgeIcon } from '@/components/points/BadgeIcon';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import { entryTone, localTitle, phaseTone } from './ChallengeCard';

/** /challenges/{slug}: the challenge, and for a signed-in student their entry, its review and the submit form. */
export function ChallengeDetail({ slug }: { slug: string }) {
  const { locale, t } = useI18n();
  const signedIn = useHasSessionCookie();
  const [pub, setPub] = useState<PublicChallengeDto | null>(null);
  const [mine, setMine] = useState<MyChallengeDto | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'error' | 'ready'>('loading');

  const loadMine = useCallback(() => {
    api<MyChallengeDto>(`/me/challenges/${encodeURIComponent(slug)}`)
      .then(setMine)
      .catch(() => undefined);
  }, [slug]);

  useEffect(() => {
    api<PublicChallengeDto>(`/challenges/${encodeURIComponent(slug)}`)
      .then((c) => {
        setPub(c);
        setState('ready');
      })
      .catch((err: unknown) => setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error'));
  }, [slug]);
  useEffect(() => {
    if (signedIn) loadMine();
  }, [signedIn, loadMine]);

  if (state === 'loading') return <PageSpinner />;
  if (state === 'missing') return <Alert tone="warning">{t('challenges.notFound')}</Alert>;
  if (state === 'error' || !pub) return <Alert tone="danger">{t('errors.generic')}</Alert>;

  const c = mine ?? pub;
  const badgeName = locale === 'ar' ? c.badge.nameAr || c.badge.nameEn : c.badge.nameEn;
  const here = `/${locale}/challenges/${slug}`;

  return (
    <div className="space-y-8">
      <Link href={`/${locale}/challenges`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">
          ←
        </span>
        {t('challenges.all')}
      </Link>
      <header className="flex items-start gap-4">
        <BadgeIcon icon={c.badge.icon} name={badgeName} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[1.75rem] break-words sm:text-[2.25rem]">{localTitle(c, locale)}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={phaseTone[c.phase]}>{t(`challenges.phase.${c.phase}`)}</Badge>
            <Badge tone="neutral">{c.course ? t('challenges.forCourse', { course: localTitle(c.course, locale) }) : t('challenges.forEveryone')}</Badge>
          </div>
          <dl className="mt-3 grid gap-1 text-sm text-body sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">{t('challenges.starts')}: </dt>
              <dd className="inline">{formatDateTime(c.startsAt, locale)}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t('challenges.ends')}: </dt>
              <dd className="inline">{formatDateTime(c.endsAt, locale)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-sm text-body">
            {c.points ? t('challenges.reward', { points: c.points, badge: badgeName }) : t('challenges.rewardBadge', { badge: badgeName })}
          </p>
        </div>
      </header>

      <section aria-label={t('challenges.brief')} className="max-w-3xl">
        <Markdown>{locale === 'ar' ? c.descriptionAr || c.descriptionEn : c.descriptionEn}</Markdown>
      </section>

      {!signedIn ? (
        <Alert tone="info">
          {t('challenges.signInToEnter')}{' '}
          <Link href={`/${locale}/login?returnTo=${encodeURIComponent(here)}`} className="font-semibold underline">
            {t('challenges.signIn')}
          </Link>
        </Alert>
      ) : mine ? (
        <EntryPanel challenge={mine} onChange={setMine} />
      ) : (
        <PageSpinner />
      )}

      <section aria-labelledby="finishers" className="max-w-3xl">
        <h2 id="finishers" className="text-xl">
          {t('challenges.finishersTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('challenges.finishers', { count: c.finishers })}</p>
        {c.finisherNames.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {c.finisherNames.map((name, i) => (
              <li key={`${name}-${i}`} className="rounded-full border border-line px-3 py-1 text-sm">
                <bdi>{name}</bdi>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EntryPanel({ challenge: c, onChange }: { challenge: MyChallengeDto; onChange: (c: MyChallengeDto) => void }) {
  const { locale, t } = useI18n();
  const entry = c.entry;
  const [url, setUrl] = useState(entry?.url ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [showName, setShowName] = useState(entry?.showName ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slug = encodeURIComponent(c.slug);

  const send = async (path: string, json: unknown, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      onChange(await api<MyChallengeDto>(path, { method: 'PUT', json }));
      setDone(message);
    } catch (err) {
      setError(errorMessage(err, t));
      if (err instanceof ApiError && err.errors.length) setErrors(Object.fromEntries(err.errors.map((e) => [e.path, t('forms.fixErrors')])));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = challengeEntrySchema.safeParse({ url, note, showName });
    if (!parsed.success) {
      const errs = issuesToErrors(parsed.error.issues, t);
      // The schema's https rule has its own wording.
      if (errs.url && url.trim()) errs.url = t('challenges.httpsOnly');
      setErrors(errs);
      return;
    }
    setErrors({});
    void send(`/me/challenges/${slug}/entry`, parsed.data, t('challenges.sent'));
  };

  return (
    <section aria-labelledby="my-entry" className="max-w-3xl rounded-card border border-line bg-card p-5 sm:p-6">
      <h2 id="my-entry" className="text-xl">
        {t('challenges.myEntry')}
      </h2>
      {entry && (
        <div role="status" className="mt-3 space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={entryTone[entry.status]}>{t(`challenges.entryStatus.${entry.status}`)}</Badge>
            <span className="text-muted">{t('challenges.submittedAt', { date: formatDateTime(entry.submittedAt, locale) })}</span>
          </p>
          <p className="text-sm text-body">{t(`challenges.entryHelp.${entry.status}`)}</p>
          {entry.feedback && (
            <div className="rounded-lg bg-muted-bg p-3 text-sm">
              <p className="font-semibold">{t('challenges.feedback')}</p>
              <p dir="auto" className="mt-1 whitespace-pre-line">
                {entry.feedback}
              </p>
            </div>
          )}
        </div>
      )}

      {c.canSubmit ? (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <TextField
            label={t('challenges.url')}
            hint={t('challenges.urlHint')}
            type="url"
            inputMode="url"
            dir="ltr"
            required
            maxLength={CHALLENGE_URL_MAX}
            value={url}
            onChange={setUrl}
            error={errors.url}
          />
          <TextAreaField label={t('challenges.note')} hint={t('challenges.noteHint')} value={note} onChange={setNote} rows={4} maxLength={CHALLENGE_NOTE_MAX} dir="auto" error={errors.note} />
          <CheckboxField label={t('challenges.showName')} hint={t('challenges.showNameHint')} checked={showName} onChange={setShowName} />
          <Button type="submit" loading={busy}>
            {t(entry ? 'challenges.resubmit' : 'challenges.submit')}
          </Button>
        </form>
      ) : (
        <>
          {c.blocked && c.blocked !== 'ALREADY_APPROVED' && <p className="mt-3 text-sm text-muted">{t(`challenges.blocked.${c.blocked}`)}</p>}
          {c.blocked === 'NOT_ELIGIBLE' && c.course && (
            <a href={`/${locale}/courses/${c.course.slug}`} className={buttonClass('secondary', 'sm', 'mt-3')}>
              {t('challenges.seeCourse')}
            </a>
          )}
          {entry && (
            <div className="mt-4">
              <CheckboxField
                label={t('challenges.showName')}
                hint={t('challenges.showNameHint')}
                checked={entry.showName}
                onChange={(v) => void send(`/me/challenges/${slug}/visibility`, { showName: v }, t('challenges.visibilitySaved'))}
              />
            </div>
          )}
        </>
      )}
      {done && (
        <p role="status" className="mt-3 text-sm font-medium text-success">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
