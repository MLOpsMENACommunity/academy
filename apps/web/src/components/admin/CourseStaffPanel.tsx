'use client';

import {
  COURSE_PERMISSION_GROUPS,
  courseRoleInputSchema,
  type CoursePermission,
  type CourseRoleDto,
  type CourseStaffDto,
  type CourseStaffMemberDto,
  type InstructorDto,
  type StaffVisibility,
} from '@academy/shared';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { CheckboxField, RadioGroup, SelectField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

type RoleDraft = { name: string; nameAr: string; permissions: CoursePermission[]; visibility: StaffVisibility; order: number };

/** The role's name in the page's language (built-in roles keep their Arabic name unless renamed). */
export function roleLabel(r: { name: string; nameAr: string | null }, locale: string): string {
  return (locale === 'ar' && r.nameAr) || r.name;
}

/**
 * Admin → Courses → {course} → Staff: who runs this course and what each role may do.
 * People: an existing account (by email) or a public speaker profile, each in one role.
 * Roles: the three built-in ones (renamable, Main instructor can't be deleted) and any others,
 * each with its permissions and whether its people are shown on the public course page.
 */
export function CourseStaffPanel({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const s = (k: string, v?: Record<string, string | number>) => t(`admin.staff.${k}`, v);
  const [data, setData] = useState<CourseStaffDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CourseStaffDto>(`/admin/courses/${courseId}/staff`)
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [courseId, t]);
  useEffect(load, [load]);

  if (error && !data) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted">{s('intro')}</p>
      {data.noMainInstructor && (
        <Alert tone="warning" title={s('noMainTitle')}>
          {s('noMainBody')}
        </Alert>
      )}
      {data.multipleMainInstructors && <Alert tone="info">{s('multipleMain')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <StaffList courseId={courseId} data={data} onData={setData} onError={setError} />
      <RolesEditor courseId={courseId} data={data} onData={setData} onError={setError} />
    </div>
  );
}

// ------------------------------------------------------------------ people

function StaffList({ courseId, data, onData, onError }: { courseId: string; data: CourseStaffDto; onData: (d: CourseStaffDto) => void; onError: (e: string | null) => void }) {
  const { locale, t } = useI18n();
  const s = (k: string, v?: Record<string, string | number>) => t(`admin.staff.${k}`, v);
  const [mode, setMode] = useState<'email' | 'profile'>('email');
  const [email, setEmail] = useState('');
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(data.roles.find((r) => r.builtin === 'CO')?.id ?? data.roles[0]?.id ?? null);
  const [profiles, setProfiles] = useState<InstructorDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const roleOptions = data.roles.map((r) => ({ value: r.id, label: roleLabel(r, locale) }));
  const headingId = useId();

  useEffect(() => {
    if (mode !== 'profile' || profiles) return;
    api<InstructorDto[]>('/admin/instructors')
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [mode, profiles]);

  async function run(key: string, fn: () => Promise<CourseStaffDto>) {
    onError(null);
    setBusy(key);
    try {
      onData(await fn());
      return true;
    } catch (err) {
      onError(errorMessage(err, t));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!roleId || (mode === 'email' ? !email.trim() : !instructorId)) return;
    const ok = await run('add', () =>
      api<CourseStaffDto>(`/admin/courses/${courseId}/staff`, { method: 'POST', json: { roleId, ...(mode === 'email' ? { email: email.trim() } : { instructorId }) } }),
    );
    if (ok) {
      setEmail('');
      setInstructorId(null);
    }
  }

  const byRole = data.roles.map((r) => ({ role: r, people: data.staff.filter((p) => p.roleId === r.id) }));
  const name = (p: CourseStaffMemberDto) => p.instructor?.name || p.user?.name || p.user?.email || '—';

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-xl">
        {s('people')}
      </h2>
      {data.staff.length === 0 && <p className="text-muted">{s('nobody')}</p>}
      <div className="space-y-4">
        {byRole
          .filter((g) => g.people.length > 0)
          .map(({ role, people }) => (
            <div key={role.id}>
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                {roleLabel(role, locale)}
                <Badge tone={role.visibility === 'SHOWN' ? 'success' : 'neutral'}>{s(role.visibility === 'SHOWN' ? 'shown' : 'anonymous')}</Badge>
              </h3>
              <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-card">
                {people.map((p) => (
                  <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="staff-row">
                    <div className="min-w-0">
                      <p className="font-semibold break-words text-fg" dir="auto">
                        {name(p)}
                      </p>
                      <p className="text-sm break-all text-muted" dir="ltr">
                        {p.user ? p.user.email : s('noAccount')}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.instructor && <Badge tone="info">{s('speakerProfile')}</Badge>}
                        {p.displayOnly && <Badge tone="warning">{s('displayOnly')}</Badge>}
                        {p.user?.deleted && <Badge tone="danger">{s('deletedAccount')}</Badge>}
                        {p.user && <Badge>{t(`admin.staff.accountRole.${p.user.role}`)}</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-full sm:w-56">
                        <SelectField
                          label={s('role')}
                          value={p.roleId}
                          options={roleOptions}
                          onChange={(v) => v && v !== p.roleId && void run(p.id, () => api<CourseStaffDto>(`/admin/courses/${courseId}/staff/${p.id}`, { method: 'PUT', json: { roleId: v } }))}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={busy === `rm-${p.id}`}
                        aria-label={`${s('remove')}: ${name(p)}`}
                        onClick={() => {
                          if (window.confirm(s('removeConfirm', { name: name(p) }))) {
                            void run(`rm-${p.id}`, () => api<CourseStaffDto>(`/admin/courses/${courseId}/staff/${p.id}`, { method: 'DELETE' }));
                          }
                        }}
                      >
                        {s('remove')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      <Card>
        <form onSubmit={add} className="space-y-4" aria-label={s('add')}>
          <h3 className="font-semibold text-fg">{s('add')}</h3>
          <RadioGroup
            legend={s('addHow')}
            value={mode}
            onChange={(v) => setMode(v as 'email' | 'profile')}
            options={[
              { value: 'email', label: s('byEmail') },
              { value: 'profile', label: s('byProfile') },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'email' ? (
              <TextField label={s('email')} hint={s('emailHint')} type="email" dir="ltr" autoComplete="off" value={email} onChange={setEmail} />
            ) : (
              <SelectField
                label={s('profile')}
                hint={s('profileHint')}
                value={instructorId}
                onChange={setInstructorId}
                options={(profiles ?? []).map((i) => ({ value: i.id, label: (locale === 'ar' && i.nameAr) || i.name }))}
              />
            )}
            <SelectField label={s('role')} required value={roleId} onChange={setRoleId} options={roleOptions} />
          </div>
          <Button type="submit" loading={busy === 'add'} disabled={!roleId || (mode === 'email' ? !email.trim() : !instructorId)}>
            {s('addButton')}
          </Button>
        </form>
      </Card>
    </section>
  );
}

// ------------------------------------------------------------------ roles

function RolesEditor({ courseId, data, onData, onError }: { courseId: string; data: CourseStaffDto; onData: (d: CourseStaffDto) => void; onError: (e: string | null) => void }) {
  const { t } = useI18n();
  const s = (k: string) => t(`admin.staff.${k}`);
  const [adding, setAdding] = useState(false);
  const headingId = useId();
  const nextOrder = Math.max(-1, ...data.roles.map((r) => r.order)) + 1;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-xl">
            {s('roles')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{s('rolesIntro')}</p>
        </div>
        {!adding && (
          <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
            + {s('newRole')}
          </Button>
        )}
      </div>
      {adding && (
        <RoleCard
          courseId={courseId}
          initial={{ name: '', nameAr: '', permissions: [], visibility: 'SHOWN', order: nextOrder }}
          onSaved={(d) => {
            onData(d);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
          onError={onError}
        />
      )}
      <ul className="space-y-4">
        {data.roles.map((r) => (
          <li key={r.id}>
            <RoleCard courseId={courseId} role={r} initial={{ name: r.name, nameAr: r.nameAr ?? '', permissions: r.permissions, visibility: r.visibility, order: r.order }} onSaved={onData} onError={onError} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleCard({
  courseId,
  role,
  initial,
  onSaved,
  onCancel,
  onError,
}: {
  courseId: string;
  role?: CourseRoleDto;
  initial: RoleDraft;
  onSaved: (d: CourseStaffDto) => void;
  onCancel?: () => void;
  onError: (e: string | null) => void;
}) {
  const { locale, t } = useI18n();
  const s = (k: string, v?: Record<string, string | number>) => t(`admin.staff.${k}`, v);
  const [v, setV] = useState<RoleDraft>(initial);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [saved, setSaved] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const toggle = (p: CoursePermission, on: boolean) => {
    setSaved(false);
    setV((x) => ({ ...x, permissions: on ? [...x.permissions, p] : x.permissions.filter((q) => q !== p) }));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    onError(null);
    const parsed = courseRoleInputSchema.safeParse({ ...v, nameAr: v.nameAr || null });
    if (!parsed.success) {
      setNameError(s('nameInvalid'));
      return;
    }
    setNameError(undefined);
    setBusy('save');
    try {
      const url = role ? `/admin/courses/${courseId}/staff/roles/${role.id}` : `/admin/courses/${courseId}/staff/roles`;
      onSaved(await api<CourseStaffDto>(url, { method: role ? 'PUT' : 'POST', json: parsed.data }));
      setSaved(true);
    } catch (err) {
      onError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!role || !window.confirm(s('deleteRoleConfirm', { name: roleLabel(role, locale) }))) return;
    onError(null);
    setBusy('delete');
    try {
      onSaved(await api<CourseStaffDto>(`/admin/courses/${courseId}/staff/roles/${role.id}`, { method: 'DELETE' }));
    } catch (err) {
      onError(errorMessage(err, t));
      setBusy(null);
    }
  }

  const title = role ? roleLabel(role, locale) : s('newRole');
  return (
    <Card className="!p-4 sm:!p-5">
      <form onSubmit={save} className="space-y-4" aria-label={title} data-testid="role-card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold break-words text-fg" dir="auto">
            {title}
          </h3>
          {role?.builtin && <Badge tone="primary">{s('builtin')}</Badge>}
          {role && <Badge>{s('members', { count: role.members })}</Badge>}
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_7rem]">
          <TextField label={s('roleName')} required value={v.name} onChange={(x) => (setSaved(false), setV({ ...v, name: x }))} error={nameError} maxLength={60} />
          <TextField label={s('roleNameAr')} dir="rtl" value={v.nameAr} onChange={(x) => (setSaved(false), setV({ ...v, nameAr: x }))} maxLength={60} />
          <TextField label={s('order')} type="number" inputMode="numeric" min={0} value={String(v.order)} onChange={(x) => (setSaved(false), setV({ ...v, order: Math.max(0, Number(x) || 0) }))} />
        </div>
        <RadioGroup
          legend={s('visibility')}
          value={v.visibility}
          onChange={(x) => (setSaved(false), setV({ ...v, visibility: x as StaffVisibility }))}
          options={[
            { value: 'SHOWN', label: s('visibilityShown') },
            { value: 'ANONYMOUS', label: s('visibilityAnonymous') },
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {COURSE_PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.key} className="rounded-card border border-line p-3">
              <legend className="px-1 text-sm font-semibold text-fg">{t(`admin.staff.groups.${g.key}`)}</legend>
              <div className="space-y-1">
                {g.permissions.map((p) => (
                  <CheckboxField key={p} label={t(`admin.staff.perm.${p}`)} hint={t(`admin.staff.permHint.${p}`)} checked={v.permissions.includes(p)} onChange={(on) => toggle(p, on)} />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy === 'save'} disabled={Boolean(role) && !dirty}>
            {role ? s('saveRole') : s('createRole')}
          </Button>
          {onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('admin.common.cancel')}
            </Button>
          )}
          {role && role.builtin !== 'MAIN' && (
            <Button type="button" variant="secondary" loading={busy === 'delete'} onClick={remove} disabled={role.members > 0} title={role.members > 0 ? s('deleteRoleBusy') : undefined}>
              {s('deleteRole')}
            </Button>
          )}
          <span role="status" className="text-sm text-success">
            {saved && !dirty ? `✓ ${t('admin.common.saved')}` : ''}
          </span>
        </div>
      </form>
    </Card>
  );
}
