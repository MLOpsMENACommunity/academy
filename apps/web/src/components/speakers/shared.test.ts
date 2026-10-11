import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/translator';
import { ApiError } from '@/lib/api';
import { speakerError } from './shared';

describe('speakerError', () => {
  const t = createTranslator('en');

  it('never shows only "Something went wrong" for a server error', () => {
    const generic = t('errors.generic');
    // A failed booking: translated, with the code to quote to the team.
    expect(speakerError(new ApiError(503, 'BOOKING_FAILED', 'The booking could not be saved (error P2028).'), t)).toBe(`${t('speakers.portal.errors.BOOKING_FAILED')} (BOOKING_FAILED)`);
    // An unknown code: the API's own message and the code.
    expect(speakerError(new ApiError(500, 'SOMETHING_NEW', 'Database said no'), t)).toBe('Database said no (SOMETHING_NEW)');
    // The edge's plain 503 while the API wakes up.
    expect(speakerError(new ApiError(503, undefined, 'Service Unavailable'), t)).toBe(t('speakers.portal.errors.unavailable'));
    // Anything else still says which error it was.
    const bare = speakerError(new ApiError(500, undefined, 'Internal server error'), t);
    expect(bare).not.toBe(generic);
    expect(bare).toContain('500');
  });

  it('keeps the friendly messages for the codes it knows', () => {
    expect(speakerError(new ApiError(409, 'SLOT_TAKEN', 'x'), t)).toBe(t('speakers.portal.errors.SLOT_TAKEN'));
    expect(speakerError(new ApiError(409, 'BOOKING_LOCKED', 'x'), t)).toBe(t('speakers.portal.errors.BOOKING_LOCKED'));
  });
});
