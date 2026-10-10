'use client';

import {
  ACTIONABLE_INVITE_OUTCOMES,
  MAX_INVITE_BATCH,
  parseEmailList,
  parseInviteCsv,
  type CourseInviteDto,
  type CourseInvitesDto,
  type InviteApplyResultDto,
  type InviteEntryInput,
  type InviteOutcome,
  type InvitePreviewDto,
  type Locale,
} from '@academy/shared';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { CheckboxField, SelectField, TextAreaField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

const OUTCOME_TONE: Record<InviteOutcome, Tone> = {
  ENROL: 'success',
  INVITE: 'info',
  INVITE_UNVERIFIED: 'info',
  ALREADY_ENROLLED: 'neutral',
  ALREADY_INVITED: 'neutral',
  SPEAKER: 'warning',
  ADMIN: 'warning',
  CLOSED: 'warning',
  INVALID: 'danger',
  DUPLICATE: 'neutral',
};
const STATUS_TONE: Record<CourseInviteDto['status'], Tone> = { PENDING: 'info', ENROLLED: 'success', REVOKED: 'neutral' };

type Source = { kind: 'text' } | { kind: 'csv'; name: string; entries: InviteEntryInput[] };

/**
 * The course admin's "Enrol by email" tab: paste addresses or upload a CSV, preview what will
 * happen to each one, confirm, and follow the invites (resend, revoke, export).
 */
export function EnrolByEmail({ courseId, paid, onChange }: { courseId: string; paid: boolean; onChange?: () => void }) {
  const { locale, t } = useI18n();
  const v = (k: string, vars?: Record<string, string | number>) => t(`admin.courses.inv.${k}`, vars);
  const [text, setText] = useState('');
  const [source, setSource] = useState<Source>({ kind: 'text' });
  const [inviteLocale, setInviteLocale] = useState<Locale>(locale);
  const [preview, setPreview] = useState<InvitePreviewDto | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [skipPayment, setSkipPayment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [list, setList] = useState<CourseInvitesDto | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CourseInvitesDto>(`/admin/courses/${courseId}/invites`)
      .then(setList)
      .catch((err) => setError(errorMessage(err, t)));
  }, [courseId, t]);
  useEffect(load, [load]);

  function entries(): InviteEntryInput[] {
    if (source.kind === 'csv') return source.entries;
    return parseEmailList(text).entries.map(({ email, name, note }) => ({ email, name, note }));
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setPreview(null);
    setDone(null);
    setError(null);
    if (!f) return;
    if (f.size > 500_000) {
      setError(v('fileTooLarge'));
      return;
    }
    const parsed = parseInviteCsv(await f.text());
    setSource({ kind: 'csv', name: f.name, entries: parsed.entries.map(({ email, name, note }) => ({ email, name, note })) });
  }

  async function runPreview() {
    setError(null);
    setDone(null);
    const list = entries();
    if (!list.length) return setError(v('nothing'));
    if (list.length > MAX_INVITE_BATCH) return setError(v('tooMany', { max: MAX_INVITE_BATCH }));
    setBusy(true);
    try {
      setPreview(await api<InvitePreviewDto>(`/admin/courses/${courseId}/invites/preview`, { method: 'POST', json: { entries: list } }));
      setSkipPayment(false);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (paid && !skipPayment) return setError(v('skipPaymentRequired'));
    setError(null);
    setBusy(true);
    try {
      const r = await api<InviteApplyResultDto>(`/admin/courses/${courseId}/invites`, {
        method: 'POST',
        json: { entries: entries(), sendEmail, skipPayment: paid && skipPayment, locale: inviteLocale },
      });
      setDone([v('done', { enrolled: r.enrolled, invited: r.invited }), r.emailed ? v('doneEmailed', { count: r.emailed }) : ''].filter(Boolean).join(' '));
      setPreview(null);
      setText('');
      setSource({ kind: 'text' });
      load();
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function act(invite: CourseInviteDto, action: 'resend' | 'revoke') {
    if (action === 'revoke' && !window.confirm(v('revokeConfirm', { email: invite.email }))) return;
    setError(null);
    setDone(null);
    setRowBusy(invite.id);
    try {
      await api(`/admin/courses/${courseId}/invites/${invite.id}/${action}`, { method: 'POST' });
      setDone(v(action === 'resend' ? 'resent' : 'revoked', { email: invite.email }));
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setRowBusy(null);
    }
  }

  async function exportCsv() {
    setError(null);
    try {
      await downloadViaApi(`/admin/courses/${courseId}/invites/export.csv`, 'course-invites.csv');
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  const count = (o: InviteOutcome) => preview?.counts[o] ?? 0;
  const toEnrol = count('ENROL');
  const toInvite = count('INVITE') + count('INVITE_UNVERIFIED');
  const over =
    preview && preview.course.capacity !== null && preview.course.seatsTaken + toEnrol > preview.course.capacity
      ? preview.course.seatsTaken + toEnrol - preview.course.capacity
      : 0;

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}

      <Card>
        <h2 className="text-lg">{v('title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{v('help')}</p>

        {!preview && (
          <div className="mt-4 space-y-4">
            {source.kind === 'text' ? (
              <TextAreaField label={v('emails')} hint={v('emailsHint')} value={text} onChange={setText} rows={6} maxLength={60_000} dir="ltr" />
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted-bg p-3 text-sm">
                <span className="ltr-embed">{v('fileEntries', { count: source.entries.length, name: source.name })}</span>
                <button type="button" onClick={() => setSource({ kind: 'text' })} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline sm:min-h-0">
                  {v('removeFile')}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted">{v('orCsv')}</p>
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-button bg-card px-4 text-sm font-medium hover:bg-hover-bg focus-within:outline-2 focus-within:outline-primary">
                {v('chooseFile')}
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e)} />
              </label>
            </div>
            <div className="max-w-sm">
              <SelectField
                label={v('language')}
                hint={v('languageHint')}
                value={inviteLocale}
                onChange={(l) => setInviteLocale(l === 'ar' ? 'ar' : 'en')}
                placeholder="—"
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'العربية' },
                ]}
              />
            </div>
            <Button onClick={() => void runPreview()} loading={busy}>
              {v('preview')}
            </Button>
          </div>
        )}
      </Card>

      {preview && (
        <Card>
          <h2 className="text-lg">{v('previewTitle')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label={v('previewTitle')}>
            {(Object.keys(OUTCOME_TONE) as InviteOutcome[])
              .filter((o) => count(o) > 0 && o !== 'INVITE_UNVERIFIED')
              .map((o) => (
                <li key={o}>
                  <Badge tone={OUTCOME_TONE[o]}>
                    {v(`outcome.${o}`)}: {o === 'INVITE' ? toInvite : count(o)}
                  </Badge>
                </li>
              ))}
          </ul>

          {over > 0 && preview.course.capacity !== null && (
            <Alert tone="warning" className="mt-4">
              {v('capacity', { taken: preview.course.seatsTaken, capacity: preview.course.capacity, count: over })}
            </Alert>
          )}

          <div className="relative mt-4 max-h-[28rem] overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="sticky top-0 bg-muted-bg text-xs text-muted">
                <tr>
                  <th scope="col" className="p-3 text-start">{v('col.email')}</th>
                  <th scope="col" className="p-3 text-start">{v('col.result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {preview.rows.map((r, i) => (
                  <tr key={`${r.email}-${i}`}>
                    <td className="p-3 align-top">
                      <p className="font-medium text-fg ltr-embed">{r.email}</p>
                      {r.name && <p className="text-xs text-muted">{r.name}</p>}
                    </td>
                    <td className="p-3 align-top">
                      <Badge tone={OUTCOME_TONE[r.outcome]}>{v(`outcome.${r.outcome}`)}</Badge>
                      <p className="mt-1 text-xs text-muted">{v(`outcomeHint.${r.outcome}`)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-4">
            <CheckboxField label={v('sendEmail')} hint={v('sendEmailHint')} checked={sendEmail} onChange={setSendEmail} />
            {paid && (toEnrol > 0 || toInvite > 0) && (
              <Alert tone="warning" title={v('paidTitle')}>
                <p>{v('paidBody')}</p>
                <div className="mt-3">
                  <CheckboxField label={v('skipPayment')} checked={skipPayment} onChange={setSkipPayment} />
                </div>
              </Alert>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => void apply()}
                loading={busy}
                disabled={!ACTIONABLE_INVITE_OUTCOMES.some((o) => count(o) > 0) || (paid && !skipPayment)}
              >
                {toEnrol + toInvite > 0 ? v('confirm', { enrol: toEnrol, invite: toInvite }) : v('confirmNothing')}
              </Button>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
                {v('edit')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">{v('listTitle')}</h2>
            {list && (
              <p className="mt-1 text-sm text-muted">
                {v('counts', { pending: list.counts.PENDING, enrolled: list.counts.ENROLLED, revoked: list.counts.REVOKED })}
              </p>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={() => void exportCsv()} disabled={!list?.items.length}>
            ⬇ {t('admin.common.export')}
          </Button>
        </div>
        {/* relative: keeps the sr-only header inside the scroll box (it would widen the page otherwise). */}
        <div className="relative mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted-bg text-xs text-muted">
              <tr>
                <th scope="col" className="p-3 text-start">{v('col.email')}</th>
                <th scope="col" className="p-3 text-start">{v('col.status')}</th>
                <th scope="col" className="p-3 text-start">{v('col.invited')}</th>
                <th scope="col" className="p-3 text-start">{v('col.emailed')}</th>
                <th scope="col" className="p-3 text-end">
                  <span className="sr-only">{v('col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {list && list.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted">
                    {v('listEmpty')}
                  </td>
                </tr>
              )}
              {!list && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted">
                    {t('admin.common.loading')}
                  </td>
                </tr>
              )}
              {list?.items.map((i) => (
                <tr key={i.id}>
                  <td className="p-3 align-top">
                    <p className="font-medium text-fg ltr-embed">{i.email}</p>
                    {i.name && <p className="text-xs text-muted">{i.name}</p>}
                    {i.note && <p className="text-xs text-muted">{i.note}</p>}
                  </td>
                  <td className="p-3 align-top">
                    <Badge tone={STATUS_TONE[i.status]}>{v(`status.${i.status}`)}</Badge>
                    {i.enrolledAt && <p className="mt-1 text-xs text-muted">{formatDate(i.enrolledAt, locale)}</p>}
                  </td>
                  <td className="p-3 align-top whitespace-nowrap">
                    {formatDate(i.createdAt, locale)}
                    {i.invitedBy && <p className="text-xs text-muted ltr-embed">{v('by', { email: i.invitedBy })}</p>}
                  </td>
                  <td className="p-3 align-top whitespace-nowrap">{i.lastEmailedAt ? formatDate(i.lastEmailedAt, locale) : <span className="text-muted">{v('never')}</span>}</td>
                  <td className="p-3 text-end align-top">
                    {i.status === 'PENDING' && (
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          disabled={rowBusy === i.id}
                          onClick={() => void act(i, 'resend')}
                          className="inline-flex min-h-11 items-center rounded px-2 text-xs font-semibold text-primary hover:underline disabled:opacity-50 sm:min-h-9"
                        >
                          {v('resend')}
                        </button>
                        <button
                          type="button"
                          disabled={rowBusy === i.id}
                          onClick={() => void act(i, 'revoke')}
                          className="inline-flex min-h-11 items-center rounded px-2 text-xs font-semibold text-danger hover:underline disabled:opacity-50 sm:min-h-9"
                        >
                          {v('revoke')}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">{v('retention')}</p>
      </Card>
    </div>
  );
}
