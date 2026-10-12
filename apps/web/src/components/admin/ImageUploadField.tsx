'use client';

import { MEDIA_MAX_BYTES, MEDIA_TYPES, type MediaUploadDto } from '@academy/shared';
import Image from 'next/image';
import { useRef, useState, type ReactNode } from 'react';
import { Field } from '@/components/forms/fields';
import { buttonClass } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/input';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * An image URL field with an "Upload image" button next to it. The upload (JPG, PNG or WebP,
 * at most 5 MB; the API checks the bytes) is stored by the academy and the field gets its
 * /api/media/… address. Pasting any https image URL still works.
 */
export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  error,
  shape = 'wide',
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  error?: string;
  /** Preview: a 16:9 cover, or a round photo. */
  shape?: 'wide' | 'round';
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const u = (k: string) => t(`admin.upload.${k}`);

  async function upload(file: File) {
    setUploadError(null);
    if (!(MEDIA_TYPES as readonly string[]).includes(file.type)) return setUploadError(u('wrongType'));
    if (file.size > MEDIA_MAX_BYTES) return setUploadError(u('tooLarge'));
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      const r = await api<MediaUploadDto>('/admin/media/upload', { method: 'POST', body });
      onChange(r.url);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setUploadError(code === 'FILE_TYPE' ? u('wrongType') : code === 'FILE_TOO_LARGE' || (err instanceof ApiError && err.status === 413) ? u('tooLarge') : errorMessage(err, t));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const shown = value && /^(https:\/\/|\/api\/media\/)/.test(value) ? value : null;
  return (
    <Field label={label} hint={hint ?? u('hint')} error={error ?? uploadError ?? undefined}>
      {({ id, describedBy, invalid }) => (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={id}
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              className={`${inputClass} min-w-0 flex-1`}
              value={value ?? ''}
              onChange={(e) => onChange(e.target.value || null)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
            />
            <label
              className={buttonClass('secondary', 'md', `shrink-0 cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--brand-primary)] ${busy ? 'pointer-events-none opacity-60' : ''}`)}
            >
              <input
                ref={input}
                type="file"
                accept={MEDIA_TYPES.join(',')}
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <span aria-hidden>⬆</span>
              {busy ? u('uploading') : u('button')}
            </label>
          </div>
          <p role="status" className="sr-only">
            {busy ? u('uploading') : ''}
          </p>
          {shown && (
            <Image
              src={shown}
              alt={u('preview')}
              unoptimized
              width={shape === 'round' ? 80 : 320}
              height={shape === 'round' ? 80 : 180}
              className={shape === 'round' ? 'size-20 rounded-full object-cover ring-1 ring-line' : 'aspect-video w-full max-w-xs rounded-lg object-cover ring-1 ring-line'}
            />
          )}
        </div>
      )}
    </Field>
  );
}
