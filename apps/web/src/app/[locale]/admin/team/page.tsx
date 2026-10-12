'use client';

import {
  ADMIN_PERMISSIONS,
  addAdminSchema,
  type AddAdminResultDto,
  type AdminPermission,
  type AdminTeamMemberDto,
} from '@academy/shared';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { RadioGroup, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

/** The presets as checkboxes, each with what it allows. */
function PresetChoice({ value, onChange, error }: { value: AdminPermission[]; onChange: (v: AdminPermission[]) => void; error?: string }) {
  const { t } = useI18n();
  const id = useId();
  const toggle = (p: AdminPermission, on: boolean) => onChange(on ? [...value, p] : value.filter((x) => x !== p));
  return (
    <fieldset aria-describedby={error ? `${id}-e` : `${id}-h`}>
      <legend className="text-sm font-semibold text-fg">{t('admin.team.presets')}</legend>
      <p id={`${id}-h`} className="mt-0.5 text-xs text-muted">
        {t('admin.team.presetsHint')}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {ADMIN_PERMISSIONS.map((p) => (
          <label key={p} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-[var(--brand-primary)]"
              checked={value.includes(p)}
              onChange={(e) => toggle(p, e.target.checked)}
              aria-invalid={error ? true : undefined}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">{t(`admin.permissions.${p}.label`)}</span>
              <span className="mt-0.5 block text-xs text-muted">{t(`admin.permissions.${p}.description`)}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-e`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function AddAdmin({ onAdded }: { onAdded: (r: AddAdminResultDto) => void }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [lang, setLang] = useState<string>(locale);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = addAdminSchema.safeParse({ email, fullNameEn: name, locale: lang, permissions });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onAdded(await api<AddAdminResultDto>('/admin/team', { method: 'POST', json: parsed.data }));
      setEmail('');
      setName('');
      setPermissions([]);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + {t('admin.team.add')}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="add-admin-title" className="w-full space-y-4 rounded-card border border-line bg-card p-4 sm:p-5">
      <h2 id="add-admin-title" className="text-lg">
        {t('admin.team.addTitle')}
      </h2>
      <p className="text-sm text-muted">{t('admin.team.addIntro')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('admin.team.email')} required type="email" dir="ltr" autoComplete="off" value={email} onChange={setEmail} error={errors.email} />
        <TextField label={t('admin.team.name')} value={name} onChange={setName} error={errors.fullNameEn} />
      </div>
      <PresetChoice value={permissions} onChange={setPermissions} error={errors.permissions} />
      <RadioGroup
        legend={t('admin.team.language')}
        value={lang}
        onChange={setLang}
        options={[
          { value: 'en', label: 'English' },
          { value: 'ar', label: 'العربية' },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          {t('admin.team.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function Member({ m, me, onChanged, onRemoved }: { m: AdminTeamMemberDto; me: boolean; onChanged: (m: AdminTeamMemberDto) => void; onRemoved: (m: AdminTeamMemberDto) => void }) {
  const { locale, t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [permissions, setPermissions] = useState<AdminPermission[]>(m.permissions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);

  async function save() {
    setError(null);
    setBusy('save');
    try {
      onChanged(await api<AdminTeamMemberDto>(`/admin/team/${m.id}`, { method: 'PUT', json: { permissions } }));
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(t('admin.team.removeConfirm', { email: m.email }))) return;
    setError(null);
    setBusy('remove');
    try {
      await api(`/admin/team/${m.id}/remove`, { method: 'POST' });
      onRemoved(m);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold break-words text-fg">
            {m.name ?? m.email}
            {me && (
              <span className="ms-2 align-middle">
                <Badge tone="info">{t('admin.team.you')}</Badge>
              </span>
            )}
          </p>
          {m.name && (
            <p className="text-sm break-all text-muted">
              <span className="ltr-embed">{m.email}</span>
            </p>
          )}
          <p className="mt-1 text-xs text-muted">{m.pending ? t('admin.team.pending') : t('admin.team.lastLogin', { date: formatDate(m.lastLoginAt!, locale) })}</p>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t('admin.team.editPresets')}
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" loading={busy === 'remove'} onClick={remove}>
              {t('admin.team.remove')}
            </Button>
          </div>
        )}
      </div>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      {editing ? (
        <div className="mt-4 space-y-3">
          <PresetChoice value={permissions} onChange={setPermissions} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy === 'save'} disabled={!permissions.length} onClick={save}>
              {t('admin.common.save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPermissions(m.permissions);
                setEditing(false);
              }}
            >
              {t('admin.common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('admin.team.presets')}>
          {m.permissions.map((p) => (
            <li key={p}>
              <Badge tone={p === 'SUPER' ? 'accent' : 'neutral'}>{t(`admin.permissions.${p}.label`)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminTeam() {
  const { t } = useI18n();
  const { user, reload } = useAuth();
  const [team, setTeam] = useState<AdminTeamMemberDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminTeamMemberDto[]>('/admin/team')
      .then(setTeam)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [t]);
  useEffect(load, [load]);

  if (!team) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl">{t('admin.team.title')}</h1>
        <p className="mt-1 max-w-2xl text-muted">{t('admin.team.intro')}</p>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      <AddAdmin
        onAdded={(r) => {
          setNotice(t(r.outcome === 'invited' ? 'admin.team.invited' : 'admin.team.promoted', { email: r.member.email }));
          load();
        }}
      />
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">{t('admin.team.count', { count: team.length })}</p>
        <p className="text-xs text-muted">{t('admin.team.lastSuperHint')}</p>
      </div>
      <ul className="space-y-3">
        {team.map((m) => (
          <li key={m.id}>
            <Member
              m={m}
              me={m.id === user?.id}
              onChanged={(next) => {
                setTeam((xs) => xs?.map((x) => (x.id === next.id ? next : x)) ?? null);
                setNotice(null);
                // My own presets changed: the nav follows at once.
                if (next.id === user?.id) void reload();
              }}
              onRemoved={(gone) => {
                setNotice(t('admin.team.removed', { email: gone.email }));
                setTeam((xs) => xs?.filter((x) => x.id !== gone.id) ?? null);
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
