'use client';

import { isDriveUrl, parseGithubRepoUrl, type MySubmissionDto, type SubmissionKind } from '@academy/shared';
import { useRef, useState, type FormEvent } from 'react';
import { CheckboxField, focusFirstInvalid, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { assessmentError } from './assessment-errors';

const MAX_BYTES = 5 * 1024 * 1024;
type Errors = Partial<Record<'url' | 'attested' | 'file', string>>;

/** Which field a server error belongs to. */
const FIELD_OF: Record<string, keyof Errors> = {
  REPO_NOT_PUBLIC: 'url',
  INVALID_GITHUB_URL: 'url',
  INVALID_DRIVE_URL: 'url',
  ATTESTATION_REQUIRED: 'attested',
  FILE_REQUIRED: 'file',
  FILE_TYPE: 'file',
  FILE_TOO_LARGE: 'file',
};

/**
 * Hands in a lab or assignment: a GitHub repository (must be public: the server
 * checks), a Google Drive/Docs link (sharing can't be checked, so the student
 * confirms it), a PDF, or any link. Errors are shown on the field and focused.
 */
export function WorkSubmission({
  slug,
  assessmentId,
  kind,
  current,
  onSaved,
}: {
  slug: string;
  assessmentId: string;
  kind: SubmissionKind;
  current: MySubmissionDto | null;
  onSaved: (s: MySubmissionDto) => void;
}) {
  const { t } = useI18n();
  const form = useRef<HTMLFormElement>(null);
  const [url, setUrl] = useState(kind === 'PDF' ? '' : (current?.url ?? ''));
  const [attested, setAttested] = useState(false);
  const [note, setNote] = useState(current?.note ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsBox = kind === 'GITHUB_REPO' || kind === 'DRIVE_LINK';

  function validate(): Errors {
    const e: Errors = {};
    if (kind === 'PDF') {
      if (!file) e.file = t('assessments.errors.FILE_REQUIRED');
      else if (file.size > MAX_BYTES) e.file = t('assessments.errors.FILE_TOO_LARGE');
      else if (file.type && file.type !== 'application/pdf') e.file = t('assessments.errors.FILE_TYPE');
      return e;
    }
    const v = url.trim();
    if (kind === 'GITHUB_REPO' && !parseGithubRepoUrl(v)) e.url = t('assessments.errors.INVALID_GITHUB_URL');
    else if (kind === 'DRIVE_LINK' && !isDriveUrl(v)) e.url = t('assessments.errors.INVALID_DRIVE_URL');
    else if (kind === 'LINK' && !/^https:\/\/\S+$/i.test(v)) e.url = t('assessments.errors.url');
    if (needsBox && !attested) e.attested = t('assessments.errors.ATTESTATION_REQUIRED');
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      focusFirstInvalid(form.current);
      return;
    }
    setBusy(true);
    try {
      const base = `/learn/${slug}/assessments/${assessmentId}/submission`;
      let saved: MySubmissionDto;
      if (kind === 'PDF') {
        const fd = new FormData();
        fd.append('note', note);
        fd.append('file', file!);
        saved = await api<MySubmissionDto>(`${base}/file`, { method: 'POST', body: fd });
      } else {
        saved = await api<MySubmissionDto>(base, { method: 'POST', json: { url: url.trim(), attested, note: note || null } });
      }
      setAttested(false);
      setFile(null);
      onSaved(saved);
    } catch (err) {
      const field = err instanceof ApiError && err.code ? FIELD_OF[err.code] : undefined;
      const msg = assessmentError(err, t);
      if (field) {
        setErrors({ [field]: msg });
        focusFirstInvalid(form.current);
      } else {
        setFormError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const label = kind === 'GITHUB_REPO' ? 'githubLabel' : kind === 'DRIVE_LINK' ? 'driveLabel' : 'linkLabel';
  return (
    <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      {kind === 'PDF' ? (
        <div>
          <label htmlFor="work-file" className="mb-1.5 block text-sm font-semibold text-fg">
            {t('assessments.work.pdfLabel')} <span className="text-danger" aria-hidden>*</span>
          </label>
          <input
            id="work-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            aria-invalid={errors.file ? true : undefined}
            aria-required="true"
            aria-describedby={errors.file ? 'work-file-error' : undefined}
            className="block w-full text-sm file:me-3 file:min-h-11 file:rounded-full file:border-0 file:bg-ink file:px-5 file:font-medium file:text-white"
          />
          {errors.file && (
            <p id="work-file-error" className="mt-1 text-sm font-medium text-danger">
              {errors.file}
            </p>
          )}
        </div>
      ) : (
        <TextField
          label={t(`assessments.work.${label}`)}
          hint={kind === 'GITHUB_REPO' ? t('assessments.work.githubHint') : kind === 'DRIVE_LINK' ? t('assessments.work.driveHint') : undefined}
          required
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          value={url}
          onChange={setUrl}
          error={errors.url}
        />
      )}
      {needsBox && (
        <CheckboxField
          label={kind === 'GITHUB_REPO' ? t('assessments.work.githubConfirm') : t('assessments.work.driveConfirm')}
          hint={kind === 'GITHUB_REPO' ? t('assessments.work.githubHelp') : t('assessments.work.driveHelp')}
          checked={attested}
          onChange={setAttested}
          error={errors.attested}
        />
      )}
      <TextAreaField label={t('assessments.work.noteLabel')} value={note} onChange={setNote} rows={3} maxLength={2000} />
      <div>
        <Button type="submit" loading={busy}>
          {current ? t('assessments.work.replace') : t('assessments.work.submit')}
        </Button>
      </div>
    </form>
  );
}
