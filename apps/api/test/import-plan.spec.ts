import { importHash, plan } from '../prisma/import-archive';

describe('archive import decisions', () => {
  const ours = { id: 'x', source: 'import', importHash: 'h1' };

  it('creates what was never imported, and never recreates what an admin deleted', () => {
    expect(plan(null, 'h1', false, false)).toEqual({ action: 'create' });
    expect(plan(null, 'h1', true, false)).toMatchObject({ action: 'skip', reason: expect.stringMatching(/deleted or renamed/) });
  });

  it('leaves records it did not create alone (e.g. a session already scheduled by an admin)', () => {
    expect(plan({ ...ours, source: null }, 'h2', false, false)).toMatchObject({ action: 'skip', reason: expect.stringMatching(/not created by the import/) });
  });

  it('skips unchanged entries and admin-edited records, and updates the rest', () => {
    expect(plan(ours, 'h1', true, true)).toEqual({ action: 'skip', reason: 'unchanged' });
    expect(plan(ours, 'h2', true, true)).toMatchObject({ action: 'skip', reason: expect.stringMatching(/edited by an admin/) });
    expect(plan(ours, 'h2', true, false)).toEqual({ action: 'update', id: 'x' });
  });

  it('hashes content, not key order', () => {
    expect(importHash({ a: 1, b: [1, { c: 2, d: new Date(0) }] })).toBe(importHash({ b: [1, { d: new Date(0), c: 2 }], a: 1 }));
    expect(importHash({ a: 1 })).not.toBe(importHash({ a: 2 }));
    expect(importHash({ a: 1, b: undefined })).toBe(importHash({ a: 1 }));
  });
});
