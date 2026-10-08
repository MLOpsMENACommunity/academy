'use client';

import { useState, type FormEvent } from 'react';
import { TextAreaField } from '@/components/forms/fields';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { StarRating } from './StarRating';

export function FeedbackForm({
  slug,
  sessionId,
  legend,
  initial,
}: {
  slug: string;
  sessionId: string | null;
  legend: string;
  initial: { rating: number; comment: string | null } | null;
}) {
  const { t } = useI18n();
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rating) return;
    setBusy(true);
    try {
      await api(`/learn/${slug}/feedback`, { method: 'PUT', json: { sessionId, rating, comment: comment || null } });
      setMsg({ ok: true, text: t('learn.feedbackSaved') });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <StarRating legend={legend} value={rating} onChange={setRating} />
      <TextAreaField label={t('learn.comment')} value={comment} onChange={setComment} rows={2} maxLength={2000} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={!rating} loading={busy}>
          {t('learn.sendFeedback')}
        </Button>
        <span role="status" className={`text-sm ${msg?.ok ? 'text-success' : 'text-danger'}`}>
          {msg?.text}
        </span>
      </div>
    </form>
  );
}
