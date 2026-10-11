'use client';

import { slotBookingSchema, type SpeakerDetailsDto, type SpeakerKind } from '@academy/shared';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { focusFirstInvalid, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { ApiError } from '@/lib/api';
import { issuesToErrors } from '@/lib/zod-errors';
import { DetailsFields, detailsToValues, KindField, valuesToDetails, type DetailsValues } from './DetailsFields';
import { speakerError } from './shared';

export interface BookingValues {
  title: string;
  abstract: string;
  kind: SpeakerKind;
  details: SpeakerDetailsDto;
}

/**
 * Title, abstract, kind and the optional details of a booking: when booking a slot, when the
 * speaker edits it while it's a draft, and when the team edits it. Only the title and
 * abstract are required. `submit` sends the parsed body; its errors are shown here.
 */
export function BookingForm({
  initial,
  submit,
  submitLabel,
  extra,
  detailsOpen = false,
}: {
  initial: BookingValues;
  submit: (body: unknown) => Promise<void>;
  submitLabel: string;
  /** More actions next to submit (e.g. "Back"). */
  extra?: ReactNode;
  detailsOpen?: boolean;
}) {
  const { t } = useI18n();
  const form = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(initial.title);
  const [abstract, setAbstract] = useState(initial.abstract);
  const [kind, setKind] = useState<SpeakerKind>(initial.kind);
  const [details, setDetails] = useState<DetailsValues>(() => detailsToValues(initial.details));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = slotBookingSchema.safeParse({ title, abstract, kind, details: valuesToDetails(details) });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      setError(t('forms.fixErrors'));
      focusFirstInvalid(form.current);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await submit(parsed.data);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.fieldErrors());
      // The API's own message (and code) when it has one, never a bare "something went wrong".
      setError(speakerError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <KindField value={kind} onChange={setKind} error={errors.kind} />
      <TextField label={t(`speakers.details.titleOf.${kind}`)} required value={title} onChange={setTitle} error={errors.title} />
      <TextAreaField label={t('speakers.portal.form.abstract')} required rows={5} maxLength={2000} value={abstract} onChange={setAbstract} error={errors.abstract} />
      <DetailsFields kind={kind} value={details} onChange={setDetails} errors={errors} open={detailsOpen} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        {extra}
      </div>
    </form>
  );
}
