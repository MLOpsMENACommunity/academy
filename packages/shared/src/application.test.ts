import { describe, expect, it } from 'vitest';
import { answerDetail, answerDetailKey, buildAnswersSchema, type QuestionLike } from './application';

const qs: QuestionLike[] = [
  { id: 'role', type: 'LONG_TEXT', required: true, options: null },
  { id: 'years', type: 'SINGLE_SELECT', required: true, options: [{ value: 'a', labelEn: 'A', labelAr: 'أ' }, { value: 'b', labelEn: 'B', labelAr: 'ب' }] },
  { id: 'clouds', type: 'MULTI_SELECT', required: true, options: [{ value: 'aws', labelEn: 'AWS', labelAr: 'AWS' }, { value: 'gcp', labelEn: 'GCP', labelAr: 'GCP' }] },
  { id: 'prod', type: 'YES_NO', required: true, options: null },
  { id: 'n', type: 'NUMBER', required: false, options: null },
  { id: 'extra', type: 'SHORT_TEXT', required: false, options: null },
];
const schema = buildAnswersSchema(qs);

describe('buildAnswersSchema', () => {
  it('accepts valid answers and drops unknown keys', () => {
    const r = schema.parse({ role: ' Lead ', years: 'a', clouds: ['aws', 'aws'], prod: false, injected: 'x' });
    expect(r).toEqual({ role: 'Lead', years: 'a', clouds: ['aws'], prod: false });
  });
  it('rejects missing required answers', () => {
    const r = schema.safeParse({ role: '', years: 'a', clouds: [], prod: undefined });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(['clouds', 'prod', 'role']);
  });
  it('rejects options that are not offered', () => {
    expect(schema.safeParse({ role: 'x', years: 'z', clouds: ['aws'], prod: true }).success).toBe(false);
    expect(schema.safeParse({ role: 'x', years: 'a', clouds: ['azure'], prod: true }).success).toBe(false);
  });
  it('never lets blank or non-numeric values stand in for a required number', () => {
    const req = buildAnswersSchema([{ id: 'n', type: 'NUMBER', required: true, options: null }]);
    for (const v of ['', '  ', null, false, [], {}, 'abc', undefined]) {
      expect(req.safeParse({ n: v }).success).toBe(false);
    }
    expect(req.parse({ n: '42' })).toEqual({ n: 42 });
    expect(req.parse({ n: -3.5 })).toEqual({ n: -3.5 });
    const opt = buildAnswersSchema([{ id: 'n', type: 'NUMBER', required: false, options: null }]);
    expect(opt.parse({ n: '' })).toEqual({});
    expect(opt.safeParse({ n: [] }).success).toBe(false);
  });

  it('coerces numbers and caps text length', () => {
    expect(schema.parse({ role: 'x', years: 'a', clouds: ['gcp'], prod: true, n: '7' }).n).toBe(7);
    expect(schema.safeParse({ role: 'x'.repeat(5000), years: 'a', clouds: ['gcp'], prod: true }).success).toBe(false);
  });
});

describe('options that ask for details (QA L24)', () => {
  const domain: QuestionLike = {
    id: 'q_domain',
    type: 'SINGLE_SELECT',
    required: true,
    options: [
      { value: 'telecom', labelEn: 'Telecom', labelAr: 'الاتصالات' },
      { value: 'own', labelEn: 'My own domain (to be approved)', labelAr: 'مجال خاص بي', requiresDetail: true },
    ],
  };
  const schema = buildAnswersSchema([domain]);
  const key = answerDetailKey('q_domain');

  it('requires a description when that option is picked', () => {
    for (const detail of [undefined, '', '   ']) {
      const r = schema.safeParse({ q_domain: 'own', [key]: detail });
      expect(r.success).toBe(false);
      expect(r.error!.issues[0]!.path).toEqual([key]);
    }
  });

  it('flags a missing description together with other missing answers', () => {
    const both = buildAnswersSchema([domain, { id: 'q_yes', type: 'YES_NO', required: true, options: null }]);
    const r = both.safeParse({ q_domain: 'own' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.')).sort()).toEqual([key, 'q_yes'].sort());
  });

  it('stores the description with the answer', () => {
    const r = schema.parse({ q_domain: 'own', [key]: '  Healthcare triage  ' });
    expect(r).toEqual({ q_domain: 'own', [key]: 'Healthcare triage' });
    expect(answerDetail(r, domain)).toBe('Healthcare triage');
  });

  it('drops a leftover description when another option is picked', () => {
    const r = schema.parse({ q_domain: 'telecom', [key]: 'Healthcare triage' });
    expect(r).toEqual({ q_domain: 'telecom' });
    expect(answerDetail(r, domain)).toBeNull();
  });

  it('caps the description length', () => {
    expect(schema.safeParse({ q_domain: 'own', [key]: 'x'.repeat(301) }).success).toBe(false);
  });

  it('leaves questions without such options unchanged', () => {
    const plain = buildAnswersSchema([{ ...domain, options: [domain.options![0]!] }]);
    expect(plain.parse({ q_domain: 'telecom', [key]: 'ignored' })).toEqual({ q_domain: 'telecom' });
  });
});
