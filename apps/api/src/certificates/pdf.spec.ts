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

describe('renderCertificatePdf (the community templates)', () => {
  const base = {
    serial: 'MLOPS-01-2026-00209',
    name: 'Test Person',
    courseTitle: 'The MLOps Practitioner Course',
    courseDescription: 'From notebooks to production: pipelines, serving, monitoring and Kubernetes deployment strategies.',
    instructors: [{ name: 'Mohamed Samy', title: 'Senior ML Engineer' }],
    issuedAt: new Date('2026-12-13T18:00:00Z'),
    verifyUrl: 'https://academy.mlopsmena.com/en/certificates/MLOPS-01-2026-00209',
  };
  const isPdf = (pdf: Buffer) => {
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(100_000); // the artwork is embedded
  };

  it('renders both designs, A4 landscape wide', async () => {
    for (const kind of ['COMPLETION', 'ATTENDANCE'] as const) {
      const pdf = await renderCertificatePdf({ ...base, kind });
      isPdf(pdf);
      expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 /);
    }
  });

  it('signs with the founder alone when she teaches, and with one or two other instructors', async () => {
    for (const instructors of [[], [{ name: 'Aya Nasser' }], [{ name: 'Sameh Mohamed', title: 'Senior MLOps Engineer' }], [{ name: 'Sameh Mohamed' }, { name: 'Omar Hassan', title: 'Data Engineer' }]]) {
      isPdf(await renderCertificatePdf({ ...base, instructors }));
    }
  });

  it('copes with long text, several instructors, no description and a name in Arabic letters', async () => {
    isPdf(
      await renderCertificatePdf({
        ...base,
        name: 'Abdelrahman Mohamed Abdelaziz Elsayed Abdelmoneim Hassan',
        courseTitle: 'Machine Learning Operations at Scale: From Experiment Tracking to Production Monitoring',
        courseDescription: 'word '.repeat(80),
        instructors: [{ name: 'Aya Nasser' }, { name: 'Mohamed Samy', title: 'Senior ML Engineer' }, { name: 'Sara Ahmed' }, { name: 'Omar Hassan' }],
      }),
    );
    isPdf(await renderCertificatePdf({ ...base, name: 'شخص تجريبي', courseDescription: null, instructors: [] }));
  });
});
