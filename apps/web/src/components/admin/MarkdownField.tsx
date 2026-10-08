'use client';

import { useState } from 'react';
import { TextAreaField } from '@/components/forms/fields';
import { Markdown } from '@/components/course/Markdown';
import { useI18n } from '@/i18n/client';

/** Markdown textarea with a preview that renders exactly like the public course page. */
export function MarkdownField({
  label,
  hint,
  value,
  onChange,
  dir,
  rows = 8,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  dir?: 'rtl' | 'ltr';
  rows?: number;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <button type="button" onClick={() => setPreview((p) => !p)} aria-pressed={preview} className="text-xs font-semibold text-primary underline">
          {preview ? t('admin.common.edit') : t('admin.common.preview')}
        </button>
      </div>
      {preview ? (
        <div className="min-h-32 rounded-lg border border-line bg-page p-4" dir={dir}>
          <p className="mb-2 text-sm font-semibold text-fg">{label}</p>
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted">{t('admin.common.none')}</p>}
        </div>
      ) : (
        <TextAreaField label={label} hint={hint} value={value} onChange={onChange} rows={rows} dir={dir} />
      )}
    </div>
  );
}
