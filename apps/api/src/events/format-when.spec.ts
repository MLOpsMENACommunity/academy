import { formatWhen } from './events.service';

describe('formatWhen', () => {
  // Egypt leaves summer time at the end of Thursday 29 October 2026.
  it('follows the Cairo clock change on 29 October', () => {
    expect(formatWhen(new Date('2026-10-29T16:00:00Z'), 'en')).toMatch(/Thursday 29 October.*19:00 (EEST|GMT\+3)/);
    expect(formatWhen(new Date('2026-10-29T21:30:00Z'), 'en')).toMatch(/23:30 (EET|GMT\+2)/);
    expect(formatWhen(new Date('2026-10-30T16:00:00Z'), 'en')).toMatch(/Friday 30 October.*18:00 (EET|GMT\+2)/);
  });

  it('uses Latin digits in Arabic and the reader’s own time zone', () => {
    const ar = formatWhen(new Date('2026-10-30T16:00:00Z'), 'ar');
    expect(ar).toMatch(/30/);
    expect(ar).toMatch(/06:00|18:00/);
    expect(formatWhen(new Date('2026-10-30T16:00:00Z'), 'en', 'Asia/Riyadh')).toMatch(/19:00/);
    expect(formatWhen(new Date('2026-10-30T16:00:00Z'), 'en', 'Not/AZone')).toMatch(/18:00/);
  });
});
