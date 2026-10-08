import { describe, expect, it } from 'vitest';
import ar from './messages/ar.json';
import en from './messages/en.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('translations', () => {
  it('Arabic has exactly the same keys as English', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
});
