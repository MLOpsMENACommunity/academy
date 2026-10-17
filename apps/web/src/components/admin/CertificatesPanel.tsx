'use client';

import { certificatePath, describeRule, MAX_BULK_CERTIFICATES, type CertificateRosterDto, type CertificateRosterRow, type CertificateRule, type IssueResultDto } from '@academy/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CheckboxField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

type Translate = (key: string, vars?: Record<string, string | number>) => string;
/** API error codes of this panel in the admin's language, else the generic message. */
function certError(err: unknown, t: Translate): string {
  if (err instanceof ApiError && err.code) {
    const key = `admin.certificates.errors.${err.code}`;
    const msg = t(key);
    if (msg !== key) return msg;
  }
  return errorMessage(err, t);
}

type Filter = 'all' | 'eligible' | 'notIssued' | 'issued' | 'revoked';
const FILTERS: Filter[] = ['all', 'eligible', 'notIssued', 'issued', 'revoked'];
const capstoneTone: Record<string, Tone> = { PASSED: 'success', PENDING: 'warning', NOT_PASSED: 'danger', MISSING: 'neutral' };

const matches = (r: CertificateRosterRow, f: Filter) =>
  f === 'all' ||
  (f === 'eligible' && r.eligibility.eligible && !r.certificate) ||
  (f === 'notIssued' && !r.certificate) ||
  (f === 'issued' && Boolean(r.certificate && !r.certificate.revokedAt)) ||
  (f === 'revoked' && Boolean(r.certificate?.revokedAt));

/** The course's certificate rule: minimum sessions, required assessments, optional wording. */
function RuleForm({ courseApi, rule, onSaved }: { courseApi: string; rule: CertificateRule; onSaved: (rule: CertificateRule) => void }) {
  const { locale, t } = useI18n();
  const r = (k: string, v?: Record<string, string | number>) => t(`admin.certificates.rule.${k}`, v);
  const [min, setMin] = useState(rule.minSessionsPercent === null ? '' : String(rule.minSessionsPercent));
  const [requireAssessments, setRequire] = useState(rule.requireAssessments);
  const [textEn, setTextEn] = useState(rule.textEn);
  const [textAr, setTextAr] = useState(rule.textAr);
  const [error, setError] = useState<string | null>(null);
  const [minError, setMinError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    const n = min.trim() === '' ? null : Number(min);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100)) {
      setMinError(t('forms.errors.invalid'));
      return;
    }
    setMinError(undefined);
    setBusy(true);
    try {
      await api(`${courseApi}/certificate-rule`, { method: 'PUT', json: { minSessionsPercent: n, requireAssessments, textEn, textAr } });
      setSaved(true);
      onSaved({ minSessionsPercent: n, requireAssessments, textEn, textAr });
    } catch (err) {
      setError(certError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-card border border-line bg-card p-4 sm:p-5">
      <summary className="min-h-11 cursor-pointer content-center">
        <span className="font-semibold">{r('title')}</span>
        <span className="mt-0.5 block text-sm text-muted">{describeRule(rule, locale)}</span>
      </summary>
      <form onSubmit={save} noValidate className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-muted">{r('hint')}</p>
        <TextField
          label={r('minSessions')}
          hint={r('minSessionsHint')}
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={min}
          onChange={setMin}
          error={minError}
          className="max-w-56"
        />
        <CheckboxField label={r('requireAssessments')} hint={r('requireAssessmentsHint')} checked={requireAssessments} onChange={setRequire} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextAreaField label={r('textEn')} hint={r('textHint')} value={textEn} onChange={setTextEn} rows={2} maxLength={500} />
          <TextAreaField label={r('textAr')} value={textAr} onChange={setTextAr} rows={2} maxLength={500} dir="rtl" />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>
            {r('save')}
          </Button>
          <p role="status" className="text-sm text-success">
            {saved ? r('saved') : ''}
          </p>
        </div>
      </form>
    </details>
  );
}

/** Revoke (with a reason) or re-issue one certificate. */
function ActionPanel({ certBase, row, kind, onDone, onClose }: { certBase: string; row: CertificateRosterRow; kind: 'revoke' | 'reissue'; onDone: (msg: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.certificates.${kind}.${k}`, v);
  const [reason, setReason] = useState('');
  const [grade, setGrade] = useState(row.certificate?.grade ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const cert = row.certificate!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (kind === 'revoke' && reason.trim().length < 3) {
      setError(a('reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`${certBase}/${cert.id}/${kind}`, { method: 'POST', json: kind === 'revoke' ? { reason } : { grade: grade || null } });
      onDone(a('done', { name: row.name ?? row.email }));
    } catch (err) {
      setError(certError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={`flex flex-col gap-3 rounded-card border p-4 sm:p-5 ${kind === 'revoke' ? 'border-danger/40 bg-danger-soft/40' : 'border-primary/40 bg-card'}`}>
      <h3 ref={heading} tabIndex={-1} className="text-lg focus:outline-none">
        {a('title', { name: row.name ?? row.email })}
      </h3>
      <p className="text-sm text-body">
        {a('body')} <span dir="ltr">{cert.serial}</span>
      </p>
      {kind === 'revoke' ? (
        <TextAreaField label={a('reason')} required value={reason} onChange={setReason} rows={3} maxLength={500} />
      ) : (
        <TextField label={t('admin.certificates.grade')} hint={t('admin.certificates.gradeHint')} value={grade} onChange={setGrade} maxLength={60} className="max-w-72" />
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={kind === 'revoke' ? 'danger' : 'primary'} loading={busy}>
          {a('confirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('admin.certificates.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Admin › course › Certificates: eligibility per enrolled student, bulk issue, revoke and re-issue, CSV. */
export function CertificatesPanel({
  courseId,
  apiBase,
  onRuleSaved,
}: {
  courseId: string;
  apiBase?: string;
  /** After the rule is saved: whether it now requires the mandatory assessments (the Assessments tab says so). */
  onRuleSaved?: (requireAssessments: boolean) => void;
}) {
  const { locale, t } = useI18n();
  /** /admin/courses/{id} (certificates at /admin/certificates/{id}), or /teach/courses/{id} for staff with ISSUE_CERTIFICATES. */
  const courseApi = apiBase ?? `/admin/courses/${courseId}`;
  const certBase = apiBase ? `${apiBase}/certificates` : '/admin/certificates';
  const c = (k: string, v?: Record<string, string | number>) => t(`admin.certificates.${k}`, v);
  const [data, setData] = useState<CertificateRosterDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grade, setGrade] = useState('');
  const [confirm, setConfirm] = useState<{ targets: CertificateRosterRow[]; notEligible: CertificateRosterRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<{ row: CertificateRosterRow; kind: 'revoke' | 'reissue' } | null>(null);

  const load = useCallback(() => {
    api<CertificateRosterDto>(`${courseApi}/certificates`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(certError(err, t)));
  }, [courseApi, t]);
  useEffect(load, [load]);

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => matches(r, filter)), [data, filter]);
  const issuable = (r: CertificateRosterRow) => !r.certificate;
  const chosen = (data?.rows ?? []).filter((r) => selected.has(r.userId) && issuable(r));

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  function summary(r: IssueResultDto): string {
    const count = (o: string) => r.results.filter((x) => x.outcome === o).length;
    return [
      c('outcome.ISSUED', { count: r.issued }),
      ...(['ALREADY_ISSUED', 'REVOKED', 'NO_NAME', 'NOT_ENROLLED'] as const).filter((o) => count(o) > 0).map((o) => c(`outcome.${o}`, { count: count(o) })),
    ].join(' ');
  }

  async function issue(targets: CertificateRosterRow[], force: boolean) {
    const notEligible = targets.filter((r) => !r.eligibility.eligible);
    if (!force && notEligible.length) {
      setConfirm({ targets, notEligible });
      return;
    }
    setConfirm(null);
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      // In batches the API accepts (a large cohort selected at once).
      const r: IssueResultDto = { results: [], issued: 0 };
      for (let i = 0; i < targets.length; i += MAX_BULK_CERTIFICATES) {
        const part = await api<IssueResultDto>(`${courseApi}/certificates`, {
          method: 'POST',
          json: { userIds: targets.slice(i, i + MAX_BULK_CERTIFICATES).map((x) => x.userId), grade: grade || null, force },
        });
        r.results.push(...part.results);
        r.issued += part.issued;
      }
      setNotice(summary(r));
      setSelected(new Set());
      load();
    } catch (err) {
      setError(certError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    try {
      await downloadViaApi(`${courseApi}/certificates.csv`, `certificates-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setError(certError(err, t));
    }
  }

  if (!data) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;

  const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
  const signals = (r: CertificateRosterRow) => {
    const e = r.eligibility;
    return (
      <>
        <span className={e.sessions.ok ? '' : 'text-danger'}>{c('sessionsValue', { completed: e.sessions.completed, total: e.sessions.total, percent: e.sessions.percent })}</span>
        <span className={e.assessments.needed && !e.assessments.ok ? 'text-danger' : ''}>
          {c('assessmentsValue', { passed: e.assessments.passed, required: e.assessments.required })}
          {e.assessments.pending > 0 && ` · ${c('pending', { count: e.assessments.pending })}`}
        </span>
      </>
    );
  };
  const status = (r: CertificateRosterRow) =>
    r.certificate ? (
      <div className="flex flex-col items-start gap-1">
        <Badge tone={r.certificate.revokedAt ? 'danger' : 'success'}>{c(r.certificate.revokedAt ? 'revoked' : 'issued')}</Badge>
        <a href={certificatePath(locale, r.certificate.serial)} target="_blank" rel="noreferrer" className="text-xs text-primary underline" dir="ltr">
          {r.certificate.serial}
        </a>
        <span className="text-xs text-muted">
          {formatDate(r.certificate.issuedAt, locale)}
          {r.certificate.grade && ` · ${r.certificate.grade}`}
        </span>
        {r.certificate.revokeReason && <span className="text-xs text-danger">{r.certificate.revokeReason}</span>}
      </div>
    ) : (
      <Badge tone={r.eligibility.eligible ? 'info' : 'neutral'}>{c(r.eligibility.eligible ? 'eligible' : 'notEligible')}</Badge>
    );
  const actions = (r: CertificateRosterRow) => (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      {!r.certificate && (
        <Button size="sm" variant="secondary" onClick={() => issue([r], false)} disabled={busy} aria-label={`${c('issueOne')}: ${r.name ?? r.email}`}>
          {c('issueOne')}
        </Button>
      )}
      {r.certificate && !r.certificate.revokedAt && (
        <Button size="sm" variant="ghost" onClick={() => setAction({ row: r, kind: 'revoke' })} aria-label={`${c('revoke.action')}: ${r.name ?? r.email}`}>
          {c('revoke.action')}
        </Button>
      )}
      {r.certificate && (
        <Button size="sm" variant="secondary" onClick={() => setAction({ row: r, kind: 'reissue' })} aria-label={`${c('reissue.action')}: ${r.name ?? r.email}`}>
          {c('reissue.action')}
        </Button>
      )}
    </div>
  );
  const check = (r: CertificateRosterRow) =>
    issuable(r) ? (
      <input
        type="checkbox"
        className="size-5 accent-[var(--brand-primary)]"
        checked={selected.has(r.userId)}
        onChange={(e) => toggle(r.userId, e.target.checked)}
        aria-label={`${c('select')}: ${r.name ?? r.email}`}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <RuleForm
        key={JSON.stringify(data.rule)}
        courseApi={courseApi}
        rule={data.rule}
        onSaved={(rule) => {
          load();
          onRuleSaved?.(rule.requireAssessments);
        }}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-body">
        <span>{c('counts.enrolled', { count: data.counts.enrolled })}</span>
        <span>{c('counts.eligible', { count: data.counts.eligible })}</span>
        <span>{c('counts.issued', { count: data.counts.issued })}</span>
        {data.counts.revoked > 0 && <span>{c('counts.revoked', { count: data.counts.revoked })}</span>}
        <Button size="sm" variant="secondary" className="ms-auto" onClick={exportCsv}>
          {c('csv')}
        </Button>
      </div>

      <div role="group" aria-label={c('filter.label')} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-10 rounded-full border px-4 text-sm font-medium ${filter === f ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-card text-body hover:bg-muted-bg'}`}
          >
            {c(`filter.${f}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSelected(new Set(data.rows.filter((r) => issuable(r) && r.eligibility.eligible).map((r) => r.userId)))}
          >
            {c('selectEligible')}
          </Button>
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {c('clear')}
            </Button>
          )}
        </div>
        <TextField label={c('grade')} hint={c('gradeHint')} value={grade} onChange={setGrade} maxLength={60} className="sm:w-64" />
        <Button onClick={() => issue(chosen, false)} disabled={!chosen.length} loading={busy}>
          {c('issueSelected', { count: chosen.length })}
        </Button>
      </div>

      {confirm && (
        <Alert tone="warning" title={c('confirm.title', { count: confirm.notEligible.length })}>
          <p>{c('confirm.body')}</p>
          <ul className="mt-2 list-disc ps-5">
            {confirm.notEligible.map((r) => (
              <li key={r.userId}>{r.name ?? r.email}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => issue(confirm.targets, true)} loading={busy}>
              {c('confirm.yes')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>
              {c('cancel')}
            </Button>
          </div>
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {action && (
        <ActionPanel
          key={`${action.kind}-${action.row.userId}`}
          certBase={certBase}
          row={action.row}
          kind={action.kind}
          onClose={() => setAction(null)}
          onDone={(msg) => {
            setAction(null);
            setNotice(msg);
            load();
          }}
        />
      )}

      {/* Phones: one card per student. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.length === 0 && <li className="rounded-card border border-line bg-card p-4 text-center text-muted">{c('none')}</li>}
        {rows.map((r) => (
          <li key={r.userId} className={`flex flex-col gap-2 rounded-card border border-line p-4 ${selected.has(r.userId) ? 'bg-primary-soft' : 'bg-card'}`}>
            <div className="flex items-start gap-3">
              {check(r)}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.name ?? '—'}</p>
                <p className="truncate text-xs text-muted" dir="ltr">
                  {r.email}
                </p>
              </div>
            </div>
            <div className="flex">{status(r)}</div>
            <div className="flex flex-col gap-0.5 text-sm text-body">
              {signals(r)}
              <span>
                {c('average')}: {pct(r.eligibility.averagePercent)}
                {r.eligibility.capstone && (
                  <>
                    {' · '}
                    {c('capstone')}: <Badge tone={capstoneTone[r.eligibility.capstone]}>{c(`capstoneState.${r.eligibility.capstone}`)}</Badge>
                  </>
                )}
              </span>
            </div>
            {actions(r)}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-card border border-line bg-card md:block">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="w-10 p-3 text-start">
                <span className="sr-only">{c('select')}</span>
              </th>
              <th className="p-3 text-start">{c('student')}</th>
              <th className="p-3 text-start">{c('progress')}</th>
              <th className="p-3 text-start">{c('average')}</th>
              <th className="p-3 text-start">{c('capstone')}</th>
              <th className="p-3 text-start">{c('certificate')}</th>
              <th className="p-3 text-start">
                <span className="sr-only">{t('admin.common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  {c('none')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.userId} className={`border-t border-line align-top ${selected.has(r.userId) ? 'bg-primary-soft' : ''}`}>
                <td className="p-3">{check(r)}</td>
                <td className="p-3">
                  <p className="font-semibold">{r.name ?? '—'}</p>
                  <p className="text-xs text-muted" dir="ltr">
                    {r.email}
                  </p>
                </td>
                <td className="p-3">
                  <div className="flex flex-col gap-0.5">{signals(r)}</div>
                </td>
                <td className="p-3 tabular-nums">{pct(r.eligibility.averagePercent)}</td>
                <td className="p-3">{r.eligibility.capstone ? <Badge tone={capstoneTone[r.eligibility.capstone]}>{c(`capstoneState.${r.eligibility.capstone}`)}</Badge> : '—'}</td>
                <td className="p-3">{status(r)}</td>
                <td className="p-3">{actions(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
