'use client';

import {
  AUTOMATION_GROUPS,
  AUTOMATION_RULES,
  automationRuleSchema,
  type AutomationAudience,
  type AutomationLogEntryDto,
  type AutomationOverviewDto,
  type AutomationParam,
  type AutomationPreviewDto,
  type AutomationRuleDef,
  type AutomationRuleDto,
} from '@academy/shared';
import { useCallback, useEffect, useState } from 'react';
import type { ZodIssue } from 'zod';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import type { Translate } from '@/i18n/translator';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

const DEFS = AUTOMATION_RULES as readonly AutomationRuleDef[];
const AUDIENCE_TONE: Record<AutomationAudience, Tone> = { student: 'primary', staff: 'accent', both: 'info' };

type Form = { params: Record<string, string>; noteEn: string; noteAr: string };

const formOf = (rule: AutomationRuleDto): Form => ({
  params: Object.fromEntries(Object.entries(rule.params).map(([k, v]) => [k, String(v)])),
  noteEn: rule.noteEn,
  noteAr: rule.noteAr,
});

/** Field errors in the viewer's language, keyed like the form ("params.days", "noteEn"). */
function fieldErrors(def: AutomationRuleDef, raw: Record<string, string>, t: Translate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, msg] of Object.entries(raw)) {
    const p = path.startsWith('params.') ? def.params.find((x) => `params.${x.key}` === path) : undefined;
    if (path === 'params.secondDays' && /second reminder/i.test(msg)) out[path] = t('admin.automation.errors.secondAfterFirst');
    else if (p && (p.kind === 'int' || p.kind === 'rating')) out[path] = t('admin.automation.errors.range', { min: p.min, max: p.max });
    else if (p?.kind === 'url') out[path] = t('forms.errors.url');
    else out[path] = msg;
  }
  return out;
}

/**
 * Course → Automation: switch the catalog's rules on per course, tune their settings, preview who
 * they would act for, and see what they did. Rules never remove a student or change an application.
 */
export function AutomationPanel({ courseId, apiBase }: { courseId: string; apiBase?: string }) {
  const { locale, t } = useI18n();
  /** /admin/courses/{id}, or /teach/courses/{id} for course staff with MANAGE_RULES. */
  const base = apiBase ?? `/admin/courses/${courseId}`;
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.automation.${k}`, v);
  const [data, setData] = useState<AutomationOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<AutomationOverviewDto>(`${base}/automation`)
      .then(setData)
      .catch((err) => setError(errorMessage(err, t)));
  }, [base, t]);
  useEffect(load, [load]);

  async function setPaused(paused: boolean) {
    if (paused && !window.confirm(a('pauseConfirm'))) return;
    setError(null);
    setBusy(true);
    try {
      setData(await api<AutomationOverviewDto>(`${base}/automation`, { method: 'PUT', json: { paused } }));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function recommended() {
    setError(null);
    setBusy(true);
    try {
      setData(await api<AutomationOverviewDto>(`${base}/automation/recommended`, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;

  const byType = new Map(data.rules.map((r) => [r.type as string, r]));
  const on = data.rules.filter((r) => r.enabled).length;
  const titleOf = (type: string) => a(`rules.${type}.title`);

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg">{a('title')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{a('help')}</p>
            <p className="mt-2 max-w-2xl text-sm font-medium text-fg">{a('safe')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" loading={busy} onClick={recommended}>
              {a('recommended')}
            </Button>
            <Button size="sm" variant={data.paused ? 'primary' : 'secondary'} loading={busy} onClick={() => setPaused(!data.paused)}>
              {data.paused ? a('resume') : a('pause')}
            </Button>
          </div>
        </div>
        <div className="mt-4" aria-live="polite">
          {data.paused ? (
            <Alert tone="warning">{a('statusPaused')}</Alert>
          ) : !data.courseActive ? (
            <Alert tone="info">{a('statusInactive')}</Alert>
          ) : (
            <p className="text-sm text-muted">{a('statusRunning', { count: on })}</p>
          )}
        </div>
      </Card>

      {data.atRisk.length > 0 && (
        <Card>
          <h2 className="text-lg">{a('attention')}</h2>
          <p className="mt-1 text-sm text-muted">{a('attentionHelp')}</p>
          <ul className="mt-3 divide-y divide-line text-sm">
            {data.atRisk.map((s) => (
              <li key={`${s.userId}:${s.reason}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{s.name ?? <span dir="ltr">{s.email}</span>}</span>
                  <span className="block text-xs text-muted">{titleOf(s.reason)}</span>
                </span>
                <span className="text-xs text-muted whitespace-nowrap">{formatDateTime(s.at, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {AUTOMATION_GROUPS.map((g) => (
        <section key={g} aria-labelledby={`automation-${g}`} className="space-y-3">
          <h3 id={`automation-${g}`} className="text-base font-semibold">
            {a(`groups.${g}`)}
          </h3>
          {DEFS.filter((d) => d.group === g).map((def) => {
            const rule = byType.get(def.type);
            return rule ? <RuleCard key={def.type} def={def} rule={rule} base={base} onSaved={setData} /> : null;
          })}
        </section>
      ))}

      <ActivityLog base={base} titleOf={titleOf} />
    </div>
  );
}

function RuleCard({ def, rule, base, onSaved }: { def: AutomationRuleDef; rule: AutomationRuleDto; base: string; onSaved: (d: AutomationOverviewDto) => void }) {
  const { t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.automation.${k}`, v);
  const [form, setForm] = useState<Form>(() => formOf(rule));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AutomationPreviewDto | null>(null);

  // A save of this rule refreshes its form from the server; other rules' saves keep unsaved edits.
  const saved = JSON.stringify(formOf(rule));
  useEffect(() => setForm(JSON.parse(saved) as Form), [saved]);

  const setParam = (k: string) => (v: string | null) => {
    setForm((f) => ({ ...f, params: { ...f.params, [k]: v ?? '' } }));
    setPreview(null);
    setDone(false);
  };

  function validate(enabled: boolean) {
    const parsed = automationRuleSchema(def).safeParse({ enabled, ...form });
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    const raw = issuesToErrors(parsed.error.issues, t);
    for (const i of parsed.error.issues as ZodIssue[]) if (i.code === 'custom') raw[i.path.join('.')] = i.message;
    setErrors(fieldErrors(def, raw, t));
    setOpen(true);
    return null;
  }

  function fail(err: unknown) {
    if (err instanceof ApiError && err.errors.length) {
      setErrors(fieldErrors(def, err.fieldErrors(), t));
      setOpen(true);
    }
    setError(errorMessage(err, t));
  }

  async function save(enabled: boolean) {
    setError(null);
    setDone(false);
    const body = validate(enabled);
    if (!body) return;
    setBusy(true);
    try {
      onSaved(await api<AutomationOverviewDto>(`${base}/automation/rules/${def.type}`, { method: 'PUT', json: body }));
      setDone(true);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setError(null);
    const body = validate(rule.enabled);
    if (!body) return;
    setBusy(true);
    try {
      setPreview(await api<AutomationPreviewDto>(`${base}/automation/rules/${def.type}/preview`, { method: 'POST', json: body }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const title = a(`rules.${def.type}.title`);
  const panelId = `automation-rule-${def.type}`;

  return (
    <Card className={rule.enabled ? 'border-primary/40' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-fg">{title}</h4>
            <Badge tone={AUDIENCE_TONE[def.audience]}>{a(`audience.${def.audience}`)}</Badge>
            {def.recommended && <Badge tone="success">{a('recommendedBadge')}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{a(`rules.${def.type}.desc`)}</p>
          <p className="mt-1 text-xs text-muted">
            {a('fired', { count: rule.fired })} · {a('firedWeek', { count: rule.firedThisWeek })}
          </p>
        </div>
        <div className="shrink-0">
          <CheckboxField
            label={
              <>
                <span className="sr-only">{title}: </span>
                {a('on')}
              </>
            }
            checked={rule.enabled}
            onChange={(v) => !busy && save(v)}
          />
        </div>
      </div>

      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline sm:min-h-9"
      >
        {open ? a('hideSettings') : a('settings')}
      </button>

      {open && (
        <div id={panelId} className="mt-2 space-y-4 border-t border-line pt-4">
          {def.params.length === 0 && !def.note && <p className="text-sm text-muted">{a('noSettings')}</p>}
          {def.params.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {def.params.map((p) => (
                <ParamField key={p.key} param={p} value={form.params[p.key] ?? ''} onChange={setParam(p.key)} error={errors[`params.${p.key}`]} />
              ))}
            </div>
          )}
          {def.note && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextAreaField
                label={a('noteEn')}
                hint={a('noteHint')}
                value={form.noteEn}
                onChange={(v) => setForm((f) => ({ ...f, noteEn: v }))}
                error={errors.noteEn}
                rows={3}
                maxLength={500}
                dir="ltr"
              />
              <TextAreaField
                label={a('noteAr')}
                hint={a('noteHint')}
                value={form.noteAr}
                onChange={(v) => setForm((f) => ({ ...f, noteAr: v }))}
                error={errors.noteAr}
                rows={3}
                maxLength={500}
                dir="rtl"
              />
            </div>
          )}

          {preview && (
            <div className="rounded-xl bg-muted-bg p-3 text-sm" aria-live="polite">
              <p className="font-medium text-fg">{a('previewCount', { count: preview.count })}</p>
              {preview.sample.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 ps-5 text-muted">
                  {preview.sample.slice(0, 20).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
              {preview.count > preview.sample.length && <p className="mt-1 text-xs text-muted">{a('previewMore', { count: preview.count - preview.sample.length })}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {done && (
              <p className="text-sm text-success" role="status">
                {a('saved')}
              </p>
            )}
            <div className="ms-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" type="button" loading={busy} onClick={runPreview}>
                {a('preview')}
              </Button>
              <Button size="sm" type="button" loading={busy} onClick={() => save(rule.enabled)}>
                {a('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ParamField({ param, value, onChange, error }: { param: AutomationParam; value: string; onChange: (v: string | null) => void; error?: string }) {
  const { t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.automation.${k}`, v);
  const label = a(`params.${param.key}`);
  if (param.kind === 'choice') {
    return (
      <SelectField label={label} value={value} onChange={(v) => onChange(v ?? param.default)} error={error} options={param.options.map((o) => ({ value: o, label: a(`options.${o}`) }))} />
    );
  }
  if (param.kind === 'url') {
    return <TextField label={label} hint={a('urlHint')} type="url" dir="ltr" inputMode="url" value={value} onChange={onChange} error={error} maxLength={500} placeholder="https://" />;
  }
  const hint = param.kind === 'int' ? a('range', { min: param.min, max: param.max, unit: a(`units.${param.key === 'rating' ? 'stars' : param.unit}`) }) : a('rangeRating', { min: param.min, max: param.max });
  return (
    <TextField
      label={label}
      hint={hint}
      type="number"
      inputMode={param.kind === 'int' ? 'numeric' : 'decimal'}
      min={param.min}
      max={param.max}
      step={param.kind === 'int' ? 1 : 0.1}
      dir="ltr"
      value={value}
      onChange={onChange}
      error={error}
    />
  );
}

const ACTION_TONE: Record<string, Tone> = { message: 'primary', email: 'info', alert: 'accent', points: 'success', certificate: 'success', flag: 'warning' };

function ActivityLog({ base, titleOf }: { base: string; titleOf: (type: string) => string }) {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.automation.${k}`, v);
  const [rows, setRows] = useState<AutomationLogEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    setBusy(true);
    try {
      setRows(await api<AutomationLogEntryDto[]>(`${base}/automation/log`));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">{a('activity')}</h2>
          <p className="mt-1 text-sm text-muted">{a('activityHelp')}</p>
        </div>
        <Button size="sm" variant="secondary" loading={busy} onClick={load}>
          {rows ? a('refresh') : a('showActivity')}
        </Button>
      </div>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      {rows && (
        // relative: keeps the sr-only header inside the scroll box (it would widen the page otherwise).
        <div className="relative mt-4 overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-muted-bg text-xs text-muted">
              <tr>
                <th className="p-3 text-start">{a('when')}</th>
                <th className="p-3 text-start">{a('rule')}</th>
                <th className="p-3 text-start">{a('subject')}</th>
                <th className="p-3 text-start">{a('done')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted">
                    {a('activityEmpty')}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="p-3 whitespace-nowrap">{formatDateTime(r.at, locale)}</td>
                  <td className="p-3">{titleOf(r.type)}</td>
                  <td className="p-3 break-words" dir="auto">
                    {r.subject}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {r.actions.map((x) => (
                        <Badge key={x} tone={ACTION_TONE[x] ?? 'neutral'}>
                          {ACTION_TONE[x] ? a(`actions.${x}`) : x}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
