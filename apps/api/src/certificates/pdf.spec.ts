import { SERIAL_PATTERN } from '@academy/shared';
import { newSerial } from './certificates.service';
import { renderCertificatePdf, visualWords } from './pdf';

describe('visualWords (word-level bidi for the PDF)', () => {
  it('keeps left-to-right lines in order', () => {
    expect(visualWords('Aya Nasser Salama')).toEqual(['Aya', 'Nasser', 'Salama']);
  });

  it('reverses the words of an Arabic line (fontkit shapes and orders each word)', () => {
    expect(visualWords('آية ناصر سلامة')).toEqual(['سلامة', 'ناصر', 'آية']);
  });

  it('keeps a Latin run in order inside an Arabic line, and digits read left to right', () => {
    expect(visualWords('أكاديمية MLOps MENA')).toEqual(['MLOps', 'MENA', 'أكاديمية']);
    expect(visualWords('13 ديسمبر 2026')).toEqual(['2026', 'ديسمبر', '13']);
  });

  it('a bilingual label on a left-to-right line keeps the Arabic run right to left', () => {
    expect(visualWords('Issued · تاريخ الإصدار', false)).toEqual(['Issued', '·', 'الإصدار', 'تاريخ']);
  });
});

describe('newSerial', () => {
  it('is MMA-<year>-<8 chars> and unique across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(newSerial(new Date('2026-12-13T00:00:00Z')));
    expect(seen.size).toBe(10_000);
    for (const s of [...seen].slice(0, 50)) {
      expect(s).toMatch(SERIAL_PATTERN);
      expect(s.startsWith('MMA-2026-')).toBe(true);
    }
  });
});

describe('renderCertificatePdf', () => {
  it('renders a PDF with English and Arabic names', async () => {
    const pdf = await renderCertificatePdf({
      serial: 'MMA-2026-7KQ4XM2P',
      name: 'Test Person',
      nameAr: 'شخص تجريبي',
      courseTitleEn: 'AI Architecture Design',
      courseTitleAr: 'تصميم معمارية الذكاء الاصطناعي',
      instructors: [{ name: 'Mohamed Samy', nameAr: null }],
      issuedAt: new Date('2026-12-13T18:00:00Z'),
      grade: 'Distinction',
      verifyUrl: 'https://academy.mlopsmena.com/en/certificates/MMA-2026-7KQ4XM2P',
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});
