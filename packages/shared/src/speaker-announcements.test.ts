import { describe, expect, it } from 'vitest';
import { SPEAKER_ANNOUNCEMENT_BODY_MAX, SPEAKER_ANNOUNCEMENT_SUBJECT_MAX, speakerAnnouncementSchema } from './speaker-announcements';

const valid = { subjectEn: 'Slides', bodyEn: 'Here they are.', idempotencyKey: 'abcdefghijklmnop' };

describe('speakerAnnouncementSchema', () => {
  it('accepts a minimal message; Arabic defaults to empty (English is used)', () => {
    expect(speakerAnnouncementSchema.parse(valid)).toEqual({ ...valid, subjectAr: '', bodyAr: '' });
  });

  it('enforces the length limits after cleaning', () => {
    expect(speakerAnnouncementSchema.safeParse({ ...valid, subjectEn: 'x'.repeat(SPEAKER_ANNOUNCEMENT_SUBJECT_MAX) }).success).toBe(true);
    expect(speakerAnnouncementSchema.safeParse({ ...valid, subjectEn: 'x'.repeat(SPEAKER_ANNOUNCEMENT_SUBJECT_MAX + 1) }).success).toBe(false);
    expect(speakerAnnouncementSchema.safeParse({ ...valid, bodyEn: 'x'.repeat(SPEAKER_ANNOUNCEMENT_BODY_MAX + 1) }).success).toBe(false);
    expect(speakerAnnouncementSchema.safeParse({ ...valid, subjectEn: ' \u0000\u0007 ' }).success).toBe(false);
    expect(speakerAnnouncementSchema.safeParse({ ...valid, idempotencyKey: 'short' }).success).toBe(false);
  });

  it('strips control and bidi-override characters and squeezes blank lines', () => {
    const out = speakerAnnouncementSchema.parse({ ...valid, subjectEn: 'Room\u202Echange\u0000', bodyEn: 'a\r\n\r\n\r\n\r\nb\tc', bodyAr: 'مرحبا\u2066' });
    expect(out.subjectEn).toBe('Roomchange');
    expect(out.bodyEn).toBe('a\n\nb\tc');
    expect(out.bodyAr).toBe('مرحبا');
  });
});
