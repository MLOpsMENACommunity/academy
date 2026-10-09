import { describe, expect, it } from 'vitest';
import { addTag } from './tags';

describe('addTag (QA M4)', () => {
  it('adds a trimmed tag', () => {
    expect(addTag(['MLflow'], '  ArgoCD ')).toEqual({ next: ['MLflow', 'ArgoCD'], rejected: null, tag: 'ArgoCD' });
  });

  it('rejects a case-insensitive duplicate without changing the list', () => {
    const r = addTag(['ArgoCD'], 'argocd');
    expect(r.rejected).toBe('duplicate');
    expect(r.next).toEqual(['ArgoCD']);
  });

  it('lets the next tag through cleanly after a duplicate (no "argocdTerraform")', () => {
    let tags = addTag([], 'ArgoCD').next;
    expect(addTag(tags, 'argocd').rejected).toBe('duplicate');
    // The input is cleared after a rejection, so only the new word is submitted.
    tags = addTag(tags, 'Terraform').next;
    expect(tags).toEqual(['ArgoCD', 'Terraform']);
  });

  it('never truncates: an over-long tag is rejected, not cut to the limit', () => {
    const long = 'x'.repeat(41);
    expect(addTag([], long, { maxLength: 40 })).toEqual({ next: [], rejected: 'tooLong', tag: long });
    expect(addTag([], 'x'.repeat(40), { maxLength: 40 }).next).toEqual(['x'.repeat(40)]);
  });

  it('stops at the maximum number of tags and ignores blanks', () => {
    expect(addTag(['a', 'b'], 'c', { max: 2 }).rejected).toBe('full');
    expect(addTag(['a'], '   ')).toEqual({ next: ['a'], rejected: null, tag: '' });
  });
});
