'use client';

import { badgeInputSchema, type BadgeDto, type PointsImportResultDto } from '@academy/shared';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { TextField } from '@/components/forms/fields';
import { BadgeIcon, badgeName } from '@/components/points/BadgeIcon';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

const emptyBadge = { code: '', nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', icon: '' };

/** Admin → Points & badges: the badge catalog (add manual badges) and the community points CSV import. */
export default function AdminPoints() {
  const { t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.points.${k}`, v);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">{a('pageTitle')}</h1>
        <p className="mt-1 max-w-3xl text-muted">{a('pageIntro')}</p>
      </div>
      <ImportCard />
      <BadgesCard />
    </div>
  );
}

function ImportCard() {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.points.${k}`, v);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PointsImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // Reset so choosing the same file again (after editing it) fires onChange.
    e.target.value = '';
    setPreview(null);
    setDone(null);
    setError(null);
    setCsv('');
    setFileName(null);
    if (!f) return;
    if (f.size > 500_000) {
      setError(a('fileTooLarge'));
      return;
    }
    setFileName(f.name);
    setCsv(await f.text());
  }

  async function send(dryRun: boolean, allowRepeat = false) {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const r = await api<PointsImportResultDto>('/admin/points/import', { method: 'POST', json: { csv, dryRun, allowRepeat } });
      if (dryRun) setPreview(r);
      else {
        setPreview(null);
        setCsv('');
        setFileName(null);
        setDone(a('imported', { count: r.applied, points: r.totalPoints }));
      }
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg">{a('importTitle')}</h2>
      <p className="mt-1 text-sm text-muted">{a('importHint')}</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-muted-bg p-3 text-xs" dir="ltr">
        {'email,points,note,course\nstudent@example.com,10,Helped 5 people on Telegram,ai-architecture-design\nother@example.com,5,Active in WhatsApp,'}
      </pre>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-button bg-card px-4 text-sm font-medium hover:bg-hover-bg">
          {a('chooseFile')}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e)} />
        </label>
        {fileName && <span className="text-sm text-muted ltr-embed">{fileName}</span>}
        <Button variant="secondary" size="sm" disabled={!csv} loading={busy && !preview} onClick={() => void send(true)}>
          {a('preview')}
        </Button>
      </div>
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      {done && (
        <Alert tone="success" className="mt-4">
          {done}
        </Alert>
      )}
      {preview && (
        <div className="mt-4 flex flex-col gap-3">
          <p role="status" className="text-sm">
            {a('previewSummary', { ok: preview.ok, errors: preview.errors, points: preview.totalPoints })}
          </p>
          <div className="max-h-80 overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="sticky top-0 bg-muted-bg text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{a('line')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">Email</th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">{a('points')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{a('course')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{a('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {preview.rows.map((r) => (
                  <tr key={r.line} className={r.status === 'error' ? 'bg-danger-soft' : undefined}>
                    <td className="px-3 py-1.5 tabular-nums">{r.line}</td>
                    <td className="px-3 py-1.5 ltr-embed">{r.email}</td>
                    <td className="px-3 py-1.5 text-end tabular-nums">{r.points || ''}</td>
                    <td className="px-3 py-1.5">{r.course ?? '–'}</td>
                    <td className="px-3 py-1.5">{r.status === 'ok' ? <Badge tone="success">{a('ok')}</Badge> : <span className="text-danger">{r.message}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.importedBefore && preview.errors === 0 && <Alert tone="warning">{a('importedBefore', { date: formatDateTime(preview.importedBefore, locale) })}</Alert>}
          {preview.errors > 0 ? (
            <Alert tone="warning">{a('fixErrors')}</Alert>
          ) : (
            <Button size="sm" className="self-start" loading={busy} onClick={() => void send(false, Boolean(preview.importedBefore))}>
              {a(preview.importedBefore ? 'applyAgain' : 'apply', { count: preview.ok, points: new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en').format(preview.totalPoints) })}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function BadgesCard() {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.points.${k}`, v);
  const [badges, setBadges] = useState<(BadgeDto & { awarded: number })[] | null>(null);
  const [form, setForm] = useState(emptyBadge);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<(BadgeDto & { awarded: number })[]>('/admin/badges')
      .then(setBadges)
      .catch((e: unknown) => setError(errorMessage(e, t)));
  }, [t]);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const parsed = badgeInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api('/admin/badges', { method: 'POST', json: parsed.data });
      setForm(emptyBadge);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.fieldErrors());
      else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(b: BadgeDto) {
    try {
      await api(`/admin/badges/${b.id}`, { method: 'PATCH', json: { active: !b.active } });
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  return (
    <Card>
      <h2 className="text-lg">{t('badges.title')}</h2>
      <p className="mt-1 text-sm text-muted">{a('badgesHint')}</p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      <ul className="mt-4 flex flex-col divide-y divide-line-soft">
        {badges?.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
            <BadgeIcon icon={b.icon} name={badgeName(b, locale)} />
            <span className="min-w-0 flex-[1_1_14rem]">
              <span className="block font-medium">
                {badgeName(b, locale)} <span className="text-xs font-normal text-muted ltr-embed">{b.code}</span>
              </span>
              <span className="block text-sm text-muted">{locale === 'ar' ? b.descriptionAr : b.descriptionEn}</span>
            </span>
            <Badge tone={b.kind === 'AUTO' ? 'info' : 'neutral'}>{a(b.kind === 'AUTO' ? 'auto' : 'manual')}</Badge>
            <span className="text-sm text-muted">{a('awardedCount', { count: b.awarded })}</span>
            <Button variant="ghost" size="sm" onClick={() => void toggle(b)}>
              {b.active ? a('deactivate') : a('activate')}
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={create} noValidate className="mt-4 rounded-xl bg-muted-bg p-4">
        <h3 className="text-base">{a('newBadge')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField label={a('code')} hint={a('codeHint')} required dir="ltr" value={form.code} error={errors.code} onChange={(v) => setForm({ ...form, code: v })} />
          <TextField label={a('icon')} hint={a('iconHint')} required value={form.icon} error={errors.icon} maxLength={16} onChange={(v) => setForm({ ...form, icon: v })} />
          <TextField label={a('nameEn')} required dir="ltr" value={form.nameEn} error={errors.nameEn} onChange={(v) => setForm({ ...form, nameEn: v })} />
          <TextField label={a('nameAr')} required dir="rtl" value={form.nameAr} error={errors.nameAr} onChange={(v) => setForm({ ...form, nameAr: v })} />
          <TextField label={a('descriptionEn')} dir="ltr" value={form.descriptionEn} error={errors.descriptionEn} onChange={(v) => setForm({ ...form, descriptionEn: v })} />
          <TextField label={a('descriptionAr')} dir="rtl" value={form.descriptionAr} error={errors.descriptionAr} onChange={(v) => setForm({ ...form, descriptionAr: v })} />
        </div>
        <Button type="submit" size="sm" className="mt-3" loading={busy}>
          {a('createBadge')}
        </Button>
      </form>
    </Card>
  );
}
