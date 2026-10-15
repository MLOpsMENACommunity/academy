import { describe, expect, it } from 'vitest';
import { assessmentResult, summarizeResults, type ResultAssessment, type ResultSubmission } from './assessments';
import {
  reissueCertificateSchema,
  certificateEligibility,
  certificateRuleSchema,
  describeRule,
  formatSerial,
  issueCertificatesSchema,
  linkedInAddUrl,
  normalizeSerial,
  SERIAL_PATTERN,
  DEFAULT_CERTIFICATE_RULE,
} from './certificates';

const bytes = (...b: number[]) => Uint8Array.from(b);

describe('serials', () => {
  it('formats MMA-<year>-<8 Crockford base32 chars>', () => {
    const s = formatSerial(2026, bytes(0, 1, 31, 32, 33, 200, 255, 10));
    expect(s).toBe('MMA-2026-01Z018ZA');
    expect(s).toMatch(SERIAL_PATTERN);
    expect(s.slice(9)).toHaveLength(8);
    // No I, L, O or U ever.
    expect(s.slice(9)).not.toMatch(/[ILOU]/);
  });

  it('maps every byte to the alphabet uniformly (byte % 32)', () => {
    expect(formatSerial(2026, bytes(0, 0, 0, 0, 0, 0, 0, 0))).toBe('MMA-2026-00000000');
    expect(formatSerial(2026, bytes(31, 63, 95, 127, 159, 191, 223, 255))).toBe('MMA-2026-ZZZZZZZZ');
    expect(formatSerial(2027, bytes(18, 18, 18, 18, 18, 18, 18, 18))).toBe('MMA-2027-JJJJJJJJ');
  });

  it('refuses too few random bytes', () => {
    expect(() => formatSerial(2026, bytes(1, 2, 3))).toThrow();
  });

  it('random serials are distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const r = new Uint8Array(8);
      for (let j = 0; j < 8; j++) r[j] = Math.floor(Math.random() * 256);
      seen.add(formatSerial(2026, r));
    }
    expect(seen.size).toBe(5000);
  });

  it('normalises typed serials and rejects anything else', () => {
    expect(normalizeSerial(' mma-2026-7kq4xm2p ')).toBe('MMA-2026-7KQ4XM2P');
    expect(normalizeSerial('MMA-2026-7KQ4XM2')).toBeNull();
    expect(normalizeSerial('MMA-2026-7KQ4XM2I')).toBeNull(); // I is not in the alphabet
    expect(normalizeSerial('../etc/passwd')).toBeNull();
    expect(normalizeSerial('')).toBeNull();
  });
});

describe('linkedInAddUrl', () => {
  it("builds LinkedIn's add-certification link", () => {
    const url = linkedInAddUrl({
      courseTitle: 'AI Architecture Design',
      issuedAt: '2026-12-13T18:00:00.000Z',
      verifyUrl: 'https://academy.mlopsmena.com/en/certificates/MMA-2026-7KQ4XM2P',
      serial: 'MMA-2026-7KQ4XM2P',
    });
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe('https://www.linkedin.com/profile/add');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      startTask: 'CERTIFICATION_NAME',
      name: 'AI Architecture Design',
      organizationId: '130374975',
      issueYear: '2026',
      issueMonth: '12',
      certUrl: 'https://academy.mlopsmena.com/en/certificates/MMA-2026-7KQ4XM2P',
      certId: 'MMA-2026-7KQ4XM2P',
    });
    expect(url).toContain('name=AI%20Architecture%20Design');
    expect(url).not.toContain('organizationName');
    expect(url).not.toContain('+');
  });

  it('uses the Cairo month (1–12) and encodes Arabic titles', () => {
    const u = new URL(linkedInAddUrl({ courseTitle: 'تصميم & بنية', issuedAt: new Date(Date.UTC(2027, 0, 1)), verifyUrl: 'https://x.test/a?b=1', serial: 'S' }));
    expect(u.searchParams.get('issueMonth')).toBe('1');
    // 23:30 UTC on 30 November is already 1 December in Cairo.
    const late = new URL(linkedInAddUrl({ courseTitle: 'x', issuedAt: '2026-11-30T23:30:00Z', verifyUrl: 'https://x.test', serial: 'S' }));
    expect([late.searchParams.get('issueYear'), late.searchParams.get('issueMonth')]).toEqual(['2026', '12']);
    const newYear = new URL(linkedInAddUrl({ courseTitle: 'x', issuedAt: '2026-12-31T23:00:00Z', verifyUrl: 'https://x.test', serial: 'S' }));
    expect([newYear.searchParams.get('issueYear'), newYear.searchParams.get('issueMonth')]).toEqual(['2027', '1']);
    expect(u.searchParams.get('name')).toBe('تصميم & بنية');
    expect(u.searchParams.get('certUrl')).toBe('https://x.test/a?b=1');
  });
});

const assessment = (id: string, countsForCertificate: boolean, maxPoints = 100, passPercent = 70): ResultAssessment => ({
  id,
  type: 'QUIZ',
  titleEn: id,
  titleAr: id,
  maxPoints,
  passPercent,
  countsForCertificate,
  scoring: 'BEST',
});
const sub = (score: number | null, attempt = 1): ResultSubmission => ({ attempt, submittedAt: new Date(), score, late: false });

function results(rows: [ResultAssessment, ResultSubmission[]][]) {
  return summarizeResults('u', 'c', rows.map(([a, s]) => assessmentResult(a, s)));
}

describe('certificateEligibility', () => {
  const rule = { minSessionsPercent: 80, requireAssessments: true };

  it('is eligible with enough sessions and every required assessment passed', () => {
    const r = results([
      [assessment('quiz', true), [sub(80)]],
      [assessment('practice', false), []],
    ]);
    const e = certificateEligibility(rule, { sessions: { completed: 8, total: 10 }, results: r });
    expect(e.eligible).toBe(true);
    expect(e.sessions).toEqual({ completed: 8, total: 10, percent: 80, required: 80, ok: true });
    expect(e.assessments).toMatchObject({ required: 1, passed: 1, ok: true, pending: 0 });
    expect(e.averagePercent).toBe(40);
    expect(e.capstone).toBeNull();
  });

  it('is not eligible below the sessions threshold', () => {
    const r = results([[assessment('quiz', true), [sub(100)]]]);
    const e = certificateEligibility(rule, { sessions: { completed: 7, total: 10 }, results: r });
    expect(e.eligible).toBe(false);
    expect(e.sessions.ok).toBe(false);
    expect(e.assessments.ok).toBe(true);
  });

  it('is not eligible while a required assessment is failed or still being graded', () => {
    const failed = results([[assessment('quiz', true), [sub(50)]]]);
    expect(certificateEligibility(rule, { sessions: { completed: 10, total: 10 }, results: failed }).eligible).toBe(false);
    const pending = results([[assessment('lab', true), [sub(null)]]]);
    const e = certificateEligibility(rule, { sessions: { completed: 10, total: 10 }, results: pending });
    expect(e.eligible).toBe(false);
    expect(e.assessments.pending).toBe(1);
  });

  it('ignores assessments when the rule does not require them, and sessions when no minimum is set', () => {
    const failed = results([[assessment('quiz', true), [sub(10)]]]);
    expect(certificateEligibility({ minSessionsPercent: 80, requireAssessments: false }, { sessions: { completed: 9, total: 10 }, results: failed }).eligible).toBe(true);
    const passed = results([[assessment('quiz', true), [sub(90)]]]);
    expect(certificateEligibility({ minSessionsPercent: null, requireAssessments: true }, { sessions: { completed: 0, total: 10 }, results: passed }).eligible).toBe(true);
  });

  it('a minimum with no sessions at all is never met; no rule at all is always met', () => {
    const none = results([]);
    expect(certificateEligibility(rule, { sessions: { completed: 0, total: 0 }, results: none }).eligible).toBe(false);
    expect(certificateEligibility(DEFAULT_CERTIFICATE_RULE, { sessions: { completed: 0, total: 0 }, results: none }).eligible).toBe(true);
    expect(certificateEligibility(DEFAULT_CERTIFICATE_RULE, { sessions: { completed: 0, total: 0 }, results: none }).averagePercent).toBeNull();
  });

  it('reports the capstone: passed, pending, not passed, missing', () => {
    const run = (s: ResultSubmission[]) =>
      certificateEligibility(rule, { sessions: { completed: 10, total: 10 }, results: results([[assessment('cap', true), s]]), capstoneIds: ['cap'] }).capstone;
    expect(run([sub(90)])).toBe('PASSED');
    expect(run([sub(null)])).toBe('PENDING');
    expect(run([sub(20)])).toBe('NOT_PASSED');
    expect(run([])).toBe('MISSING');
  });
});

describe('rule input and wording', () => {
  it('validates the rule', () => {
    expect(certificateRuleSchema.safeParse({ minSessionsPercent: 80, requireAssessments: true }).success).toBe(true);
    expect(certificateRuleSchema.safeParse({ minSessionsPercent: 0, requireAssessments: true }).success).toBe(false);
    expect(certificateRuleSchema.safeParse({ minSessionsPercent: 101, requireAssessments: true }).success).toBe(false);
    expect(certificateRuleSchema.safeParse({ minSessionsPercent: null, requireAssessments: false, textEn: 'x'.repeat(501) }).success).toBe(false);
  });

  it('describes the rule, preferring the course team’s own text', () => {
    const r = { ...DEFAULT_CERTIFICATE_RULE, minSessionsPercent: 80 };
    expect(describeRule(r, 'en')).toBe('To earn the certificate, pass every assessment required for the certificate and complete at least 80% of the sessions.');
    expect(describeRule(r, 'ar')).toContain('80٪');
    expect(describeRule({ ...r, textEn: 'Pass the capstone.', textAr: '' }, 'ar')).toBe('Pass the capstone.');
    expect(describeRule({ ...r, requireAssessments: false, minSessionsPercent: null }, 'en')).toMatch(/course team issues/);
  });

  it('bulk issue input: at least one student, optional grade', () => {
    expect(issueCertificatesSchema.parse({ userIds: ['a'] })).toEqual({ userIds: ['a'], grade: null, force: false });
    expect(issueCertificatesSchema.parse({ userIds: ['a'], grade: '  Distinction ' }).grade).toBe('Distinction');
    expect(issueCertificatesSchema.safeParse({ userIds: [] }).success).toBe(false);
  });
});

describe('reissueCertificateSchema', () => {
  it('keeps the grade when none is sent, and clears it on null or empty', () => {
    expect(reissueCertificateSchema.parse({}).grade).toBeUndefined();
    expect(reissueCertificateSchema.parse({ grade: null }).grade).toBeNull();
    expect(reissueCertificateSchema.parse({ grade: '  ' }).grade).toBeNull();
    expect(reissueCertificateSchema.parse({ grade: ' Merit ' }).grade).toBe('Merit');
  });
});
