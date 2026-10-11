'use client';

import { useState } from 'react';
import { SelectField } from '@/components/forms/fields';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { EnrolByEmail } from './EnrolByEmail';

export interface CourseChoice {
  id: string;
  titleEn: string;
  titleAr: string;
  type?: 'FREE' | 'PAID' | string;
}

/**
 * "Add accepted emails" on Admin → Applications: opens the course's Enrol-by-email tool (the
 * same component as the course's own tab, so the rules are the same). On the course's
 * Applications tab the course is known; on the global page the admin picks one first (the
 * course filter, when set, is preselected).
 */
export function AddAcceptedEmails({
  courseId,
  paid,
  courses = [],
  onChange,
}: {
  courseId?: string | null;
  paid?: boolean;
  /** The global page: the courses to pick from. */
  courses?: CourseChoice[];
  onChange?: () => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(courseId ?? null);
  const fixed = Boolean(courseId && !courses.length);
  const id = fixed ? courseId! : picked;
  const course = courses.find((c) => c.id === id);
  const isPaid = fixed ? Boolean(paid) : course?.type === 'PAID';

  return (
    <div className="w-full">
      <Button
        size="sm"
        variant={open ? 'secondary' : 'primary'}
        aria-expanded={open}
        aria-controls="add-accepted-emails"
        onClick={() => {
          setOpen((o) => !o);
          if (!fixed && courseId) setPicked(courseId);
        }}
      >
        {open ? t('admin.acceptedEmails.close') : `+ ${t('admin.acceptedEmails.button')}`}
      </Button>
      {open && (
        <div id="add-accepted-emails" className="mt-4 space-y-4 rounded-card border border-line bg-card p-4">
          <div>
            <h2 className="text-lg">{t('admin.acceptedEmails.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.acceptedEmails.intro')}</p>
          </div>
          {!fixed && (
            <SelectField
              label={t('admin.acceptedEmails.course')}
              required
              value={picked}
              onChange={setPicked}
              placeholder={t('admin.acceptedEmails.pick')}
              options={courses.map((c) => ({ value: c.id, label: (locale === 'ar' && c.titleAr) || c.titleEn }))}
            />
          )}
          {id && <EnrolByEmail key={id} courseId={id} paid={isPaid} onChange={onChange} />}
        </div>
      )}
    </div>
  );
}
