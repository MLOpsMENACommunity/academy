import { describe, expect, it } from 'vitest';
import { buildAnswersSchema, type QuestionLike } from './application';

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
  it('coerces numbers and caps text length', () => {
    expect(schema.parse({ role: 'x', years: 'a', clouds: ['gcp'], prod: true, n: '7' }).n).toBe(7);
    expect(schema.safeParse({ role: 'x'.repeat(5000), years: 'a', clouds: ['gcp'], prod: true }).success).toBe(false);
  });
});
