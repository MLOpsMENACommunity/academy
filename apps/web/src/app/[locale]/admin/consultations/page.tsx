'use client';

import {
  CONSULTATION_STATUSES,
  hasAdminPermission,
  type AdminConsultantRowDto,
  type ConsultantSettingsDto,
  type ConsultationBookingAdminDto,
  type ConsultationStatus,
} from '@academy/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ConsultantSettingsForm, EMPTY_SETTINGS } from '@/components/consultations/ConsultantSettingsForm';
import { egp, expertName, StatusBadge, whenLabel } from '@/components/consultations/shared';
import { SelectField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { viewerTimezone } from '@/lib/format';

type Tab = 'bookings' | 'experts';

/** Admin → Consultations: bookings and payments (FINANCE), who is listed and how (SPEAKERS). */
export default function AdminConsultationsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tabs: Tab[] = [
    ...(hasAdminPermission(user, ['FINANCE']) ? (['bookings'] as const) : []),
    ...(hasAdminPermission(user, ['SPEAKERS']) ? (['experts'] as const) : []),
  ];
  const [tab, setTab] = useState<Tab | null>(null);
  const shown = tab && tabs.includes(tab) ? tab : tabs[0];
  if (!shown) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.75rem]">{t('consultations.admin.title')}</h1>
        <p className="mt-1 text-muted">{t('consultations.admin.intro')}</p>
      </div>
      {tabs.length > 1 && (
        <div role="tablist" aria-label={t('consultations.admin.title')} className="flex gap-1 border-b border-line">
          {tabs.map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={shown === k}
              onClick={() => setTab(k)}
              className={`min-h-10 border-b-2 px-3 text-sm font-semibold ${shown === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {t(`consultations.admin.tabs.${k}`)}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel">{shown === 'bookings' ? <Bookings /> : <Experts />}</div>
    </div>
  );
}

function Bookings() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<ConsultationStatus | ''>('AWAITING_PAYMENT');
  const [rows, setRows] = useState<ConsultationBookingAdminDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tz, setTz] = useState('Africa/Cairo');
  const [acting, setActing] = useState<{ id: string; kind: 'paid' | 'cancel' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTz(viewerTimezone());
    let current = true;
    setRows(null);
    setError(null);
    api<ConsultationBookingAdminDto[]>(`/admin/consultations/bookings${status ? `?status=${status}` : ''}`)
      .then((r) => current && setRows(r))
      .catch((err) => current && setError(errorMessage(err, t)));
    return () => {
      current = false;
    };
  }, [status, t]);

  async function act(id: string, kind: 'paid' | 'cancel') {
    setBusy(true);
    setError(null);
    try {
      const b = await api<ConsultationBookingAdminDto>(`/admin/consultations/bookings/${id}/${kind}`, { method: 'POST', ...(kind === 'cancel' ? { json: { reason } } : {}) });
      setRows((r) => r && r.map((x) => (x.id === id ? b : x)));
      setActing(null);
      setReason('');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
        <SelectField
          label={t('consultations.admin.filter')}
          value={status}
          onChange={(v) => setStatus((v ?? '') as ConsultationStatus | '')}
          placeholder={t('consultations.admin.all')}
          options={CONSULTATION_STATUSES.map((s) => ({ value: s, label: t(`consultations.status.${s}`) }))}
        />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!rows ? (
        <PageSpinner />
      ) : rows.length === 0 ? (
        <p className="text-muted">{t('consultations.admin.noBookings')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((b) => {
            const payable = (b.status === 'AWAITING_PAYMENT' || b.status === 'EXPIRED') && new Date(b.startsAt).getTime() > now;
            return (
              <li key={b.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="flex-1 font-medium text-fg">
                      {b.reference} · {expertName(b.consultant, locale)} · {whenLabel(b.startsAt, locale, tz)}
                    </p>
                    <StatusBadge status={b.status} t={t} />
                  </div>
                  <p className="text-[0.9375rem] text-body">
                    {b.student.name} · <span dir="ltr">{b.student.email}</span> · {t('consultations.minutes', { min: b.durationMin })} · {egp(b.priceEgp, locale)}
                  </p>
                  {b.status === 'AWAITING_PAYMENT' && b.holdUntil && (
                    <p className="text-[0.875rem] text-muted">{t('consultations.admin.heldUntil', { time: whenLabel(b.holdUntil, locale, tz) })}</p>
                  )}
                  {b.paidAt && <p className="text-[0.875rem] text-muted">{t('consultations.admin.paidAt', { time: whenLabel(b.paidAt, locale, tz) })}</p>}
                  {b.status === 'CANCELLED' && b.paidAt && <Badge tone="warning">{t('consultations.admin.refundDue')}</Badge>}
                  {b.cancelReason && <p className="text-[0.875rem] text-muted">{t('consultations.booking.reason', { reason: b.cancelReason })}</p>}
                  {b.note && <p className="text-[0.875rem] whitespace-pre-line text-muted">{b.note}</p>}

                  {acting?.id === b.id ? (
                    <div className="flex flex-col gap-2">
                      {acting.kind === 'paid' ? (
                        <p className="text-[0.9375rem] text-fg">{t('consultations.admin.confirmPaid', { ref: b.reference, price: egp(b.priceEgp, locale) })}</p>
                      ) : (
                        <TextField label={t('consultations.booking.cancelReason')} value={reason} onChange={setReason} maxLength={500} />
                      )}
                      <div className="flex gap-2">
                        <Button type="button" variant={acting.kind === 'paid' ? 'primary' : 'danger'} size="sm" loading={busy} onClick={() => void act(b.id, acting.kind)}>
                          {t(acting.kind === 'paid' ? 'consultations.admin.markPaidYes' : 'consultations.booking.cancelYes')}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setActing(null)}>
                          {t('consultations.booking.keep')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    (payable || b.canCancel) && (
                      <div className="flex flex-wrap gap-2">
                        {payable && (
                          <Button type="button" size="sm" onClick={() => setActing({ id: b.id, kind: 'paid' })}>
                            {t('consultations.admin.markPaid')}
                          </Button>
                        )}
                        {b.canCancel && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setActing({ id: b.id, kind: 'cancel' })}>
                            {t('consultations.booking.cancel')}
                          </Button>
                        )}
                      </div>
                    )
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Experts() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminConsultantRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    api<AdminConsultantRowDto[]>('/admin/consultations/experts')
      .then(setRows)
      .catch((err) => setError(errorMessage(err, t)));
  }, [t]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!rows) return <PageSpinner />;
  const experts = rows.filter((r) => r.settings);
  const others = rows.filter((r) => !r.settings && r.slug);
  const save = (instructorId: string) => async (body: Omit<ConsultantSettingsDto, 'enabled'> & { enabled?: boolean }) => {
    const next = await api<ConsultantSettingsDto>(`/admin/consultations/experts/${instructorId}`, { method: 'PUT', json: body });
    setRows((r) => r && r.map((x) => (x.instructorId === instructorId ? { ...x, settings: next } : x)));
    return next;
  };

  return (
    <div className="flex flex-col gap-4">
      {experts.length === 0 && <p className="text-muted">{t('consultations.admin.noExperts')}</p>}
      <ul className="flex flex-col gap-3">
        {experts.map((r) => (
          <li key={r.instructorId}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 font-medium text-fg">{r.name}</p>
                <Badge tone={r.settings!.enabled ? 'success' : 'neutral'}>{t(r.settings!.enabled ? 'consultations.admin.listed' : 'consultations.admin.notListed')}</Badge>
                <span className="text-[0.875rem] text-muted">{t('consultations.admin.upcoming', { count: r.upcoming })}</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(editing === r.instructorId ? null : r.instructorId)}>
                  {t(editing === r.instructorId ? 'consultations.admin.close' : 'consultations.admin.edit')}
                </Button>
              </div>
              {!r.hasAccount && <Alert tone="warning">{t('consultations.admin.noAccount')}</Alert>}
              {editing === r.instructorId && <ConsultantSettingsForm initial={r.settings!} withEnabled onSave={save(r.instructorId)} />}
            </Card>
          </li>
        ))}
      </ul>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg">{t('consultations.admin.addTitle')}</h2>
        <SelectField
          label={t('consultations.admin.addPick')}
          hint={t('consultations.admin.addHint')}
          value={adding}
          onChange={setAdding}
          options={others.map((r) => ({ value: r.instructorId, label: r.hasAccount ? r.name : `${r.name} (${t('consultations.admin.noAccountShort')})` }))}
        />
        {adding && (
          <ConsultantSettingsForm
            key={adding}
            initial={EMPTY_SETTINGS}
            withEnabled
            onSave={async (body) => {
              const next = await save(adding)(body);
              setRows((r) => r && r.map((x) => (x.instructorId === adding ? { ...x, settings: next } : x)));
              setEditing(adding);
              setAdding(null);
              return next;
            }}
          />
        )}
      </Card>
    </div>
  );
}
