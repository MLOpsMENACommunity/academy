'use client';

import { useState, type FormEvent } from 'react';
import { TextAreaField } from '@/components/forms/fields';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export interface Note {
  id: string;
  body: string;
  author: string | null;
  createdAt: string;
}

/** Internal admin notes (never shown to the student). */
export function Notes({ notes: initial, postUrl }: { notes: Note[]; postUrl: string }) {
  const { locale, t } = useI18n();
  const [notes, setNotes] = useState(initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const n = await api<Note>(postUrl, { method: 'POST', json: { body } });
      setNotes([n, ...notes]);
      setBody('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <form onSubmit={onSubmit} className="space-y-2">
        <TextAreaField label={t('admin.common.addNote')} hint={t('admin.common.notePlaceholder')} value={body} onChange={setBody} rows={2} maxLength={4000} />
        <Button type="submit" size="sm" variant="secondary" disabled={!body.trim()} loading={busy}>
          {t('admin.common.addNote')}
        </Button>
      </form>
      <ul className="mt-4 space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-muted-bg p-3 text-sm">
            <p className="whitespace-pre-line text-fg">{n.body}</p>
            <p className="mt-1 text-xs text-muted">
              {n.author ?? '—'} · {formatDateTime(n.createdAt, locale)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
