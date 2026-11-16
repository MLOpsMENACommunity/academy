'use client';

import { TESTIMONIAL_MAX, TESTIMONIAL_MIN, testimonialSchema, type MyTestimonialDto } from '@academy/shared';
import { useState, type FormEvent } from 'react';
import { CheckboxField, TextAreaField } from '@/components/forms/fields';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { StarRating } from './StarRating';

/**
 * Asks a student who finished the course for a review: 1–5 stars and/or a few words. Shown only
 * when the API says they may (LearnCourseDto.canReview). Never required for the certificate.
 * Saving always sends it back to the team for review (status PENDING).
 */
export function TestimonialForm({ slug, initial, onChanged }: { slug: string; initial: MyTestimonialDto | null; onChanged: () => void }) {
  const { t } = useI18n();
  const [body, setBody] = useState(initial?.body ?? '');
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const json = { body, rating: rating || null, consent };
  const valid = testimonialSchema.safeParse(json).success;
  // Neither stars nor words yet: say what's needed (once they've agreed, so it isn't shouted at first).
  const needOne = consent && !rating && !body.trim();

  const run = async (call: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await call;
      setConsent(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) void run(api(`/learn/${slug}/testimonial`, { method: 'PUT', json }));
  };
  const remove = () => {
    setBody('');
    setRating(0);
    void run(api(`/learn/${slug}/testimonial`, { method: 'DELETE' }));
  };

  return (
    <section id="testimonial" aria-labelledby="testimonial-title" className="scroll-mt-6 rounded-xl border border-primary/30 bg-primary-soft p-5 sm:p-6">
      <h2 id="testimonial-title" className="text-lg sm:text-xl">
        {t('learn.testimonial.title')}
      </h2>
      <p className="mt-1 text-body">{t('learn.testimonial.intro')}</p>
      {initial && (
        <p role="status" className="mt-3 text-sm font-medium text-fg">
          {t(`learn.testimonial.status.${initial.status}`)}
        </p>
      )}
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-x-3">
          <StarRating legend={t('learn.testimonial.ratingLegend')} value={rating} onChange={setRating} large />
          {rating > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setRating(0)}>
              {t('learn.testimonial.clearRating')}
            </Button>
          )}
        </div>
        <TextAreaField
          label={t('learn.testimonial.label')}
          hint={t('learn.testimonial.hint', { min: TESTIMONIAL_MIN, max: TESTIMONIAL_MAX })}
          value={body}
          onChange={setBody}
          rows={4}
          maxLength={TESTIMONIAL_MAX}
        />
        <CheckboxField label={t('learn.testimonial.consent')} checked={consent} onChange={setConsent} />
        {needOne && <p className="text-sm text-muted">{t('learn.testimonial.needOne')}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!valid} loading={busy}>
            {t(initial ? 'learn.testimonial.update' : 'learn.testimonial.send')}
          </Button>
          {initial && (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={remove}>
              {t('learn.testimonial.remove')}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
