import { describe, expect, it } from 'vitest';
import { auditLines } from './audit';

describe('auditLines (QA L26: readable audit details)', () => {
  it('a status change', () => {
    expect(auditLines({ from: 'SUBMITTED', to: 'ACCEPTED', hasReason: true })).toEqual([
      'status: SUBMITTED → ACCEPTED',
      'hasReason: true',
    ]);
  });
  it('field changes and plain values', () => {
    expect(
      auditLines({
        slug: 'docker',
        status: { from: 'DRAFT', to: 'PUBLISHED' },
        durationMin: { from: 60, to: 90 },
        liveUrlChanged: true,
      }),
    ).toEqual([
      'slug: docker',
      'status: DRAFT → PUBLISHED',
      'durationMin: 60 → 90',
      'liveUrlChanged: true',
    ]);
  });
  it('lists, empty values and a lone "from"', () => {
    expect(auditLines({ keys: ['a', 'b'], statuses: null, from: 'c1' })).toEqual([
      'keys: a, b',
      'statuses: —',
      'from: c1',
    ]);
    expect(auditLines({ status: { from: null, to: 'OPEN' } })).toEqual(['status: — → OPEN']);
  });
  it('nothing to show', () => {
    expect(auditLines({})).toEqual([]);
    expect(auditLines(null)).toEqual([]);
  });
});
