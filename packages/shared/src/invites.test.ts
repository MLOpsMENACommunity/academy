import { describe, expect, it } from 'vitest';
import { classifyInvite, countOutcomes, inviteApplySchema, normaliseEmail, parseEmailList, parseInviteCsv, type InviteFacts } from './invites';

describe('normaliseEmail', () => {
  it('lower-cases and trims', () => {
    expect(normaliseEmail('  Mona.Ali@Example.COM ')).toBe('mona.ali@example.com');
  });

  it('takes the address out of the usual pasted shapes', () => {
    expect(normaliseEmail('Mona Ali <mona@example.com>')).toBe('mona@example.com');
    expect(normaliseEmail('mailto:Mona@Example.com')).toBe('mona@example.com');
    expect(normaliseEmail('"mona@example.com"')).toBe('mona@example.com');
    expect(normaliseEmail('(mona@example.com),')).toBe('mona@example.com');
  });

  it('rejects what is not an address', () => {
    for (const bad of ['', 'mona', 'mona@', '@example.com', 'mona@@example.com', 'a b@example.com', `${'x'.repeat(250)}@example.com`]) {
      expect(normaliseEmail(bad)).toBeNull();
    }
  });
});

describe('parseEmailList', () => {
  it('splits on commas, semicolons, spaces and new lines, and dedupes case-insensitively', () => {
    const { entries } = parseEmailList('a@x.com, b@x.com;c@x.com\n\nd@x.com e@x.com\r\nA@X.com');
    expect(entries.map((e) => e.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'a@x.com']);
    expect(entries.map((e) => e.duplicate)).toEqual([false, false, false, false, false, true]);
    expect(entries.every((e) => e.valid)).toBe(true);
  });

  it('reads "Name <address>" and "Name address" without turning names into invalid rows', () => {
    const { entries } = parseEmailList('Mona Ali <mona@x.com>, Omar Said omar@x.com\nnot-an-email');
    expect(entries).toEqual([
      { email: 'mona@x.com', name: null, note: null, valid: true, duplicate: false },
      { email: 'omar@x.com', name: null, note: null, valid: true, duplicate: false },
      { email: 'not-an-email', name: null, note: null, valid: false, duplicate: false },
    ]);
  });

  it('returns nothing for blank input', () => {
    expect(parseEmailList(' \n, ;').entries).toEqual([]);
  });
});

describe('parseInviteCsv', () => {
  it('uses a header row in any order', () => {
    const csv = '﻿Note,Full name,Email\r\n"Sponsored, cohort 3",Mona Ali,Mona@X.com\r\n,Omar,omar@x.com\r\n';
    expect(parseInviteCsv(csv).entries).toEqual([
      { email: 'mona@x.com', name: 'Mona Ali', note: 'Sponsored, cohort 3', valid: true, duplicate: false },
      { email: 'omar@x.com', name: 'Omar', note: null, valid: true, duplicate: false },
    ]);
  });

  it('without a header, reads email, name, note from the first three columns', () => {
    const { entries } = parseInviteCsv('mona@x.com,Mona,VIP\nbroken,,\nmona@x.com');
    expect(entries.map((e) => [e.email, e.name, e.note, e.valid, e.duplicate])).toEqual([
      ['mona@x.com', 'Mona', 'VIP', true, false],
      ['broken', null, null, false, false],
      ['mona@x.com', null, null, true, true],
    ]);
  });

  it('handles an empty file', () => {
    expect(parseInviteCsv('').entries).toEqual([]);
  });
});

describe('classifyInvite', () => {
  const base: InviteFacts = { valid: true, duplicate: false, account: null, enrolled: false, invite: null };
  const student = { role: 'STUDENT' as const, verified: true, deleted: false };

  it('enrols a verified student now and invites everyone else', () => {
    expect(classifyInvite({ ...base, account: student })).toBe('ENROL');
    expect(classifyInvite(base)).toBe('INVITE');
    expect(classifyInvite({ ...base, account: { ...student, verified: false } })).toBe('INVITE_UNVERIFIED');
  });

  it('skips what needs nothing or must not be enrolled', () => {
    expect(classifyInvite({ ...base, valid: false })).toBe('INVALID');
    expect(classifyInvite({ ...base, duplicate: true, account: student })).toBe('DUPLICATE');
    expect(classifyInvite({ ...base, account: student, enrolled: true })).toBe('ALREADY_ENROLLED');
    expect(classifyInvite({ ...base, invite: 'PENDING' })).toBe('ALREADY_INVITED');
    expect(classifyInvite({ ...base, account: { ...student, role: 'SPEAKER' } })).toBe('SPEAKER');
    expect(classifyInvite({ ...base, account: { ...student, role: 'ADMIN' } })).toBe('ADMIN');
    expect(classifyInvite({ ...base, account: { ...student, deleted: true } })).toBe('CLOSED');
  });

  it('lets a revoked invite be sent again, and an enrolled one stays enrolled', () => {
    expect(classifyInvite({ ...base, invite: 'REVOKED' })).toBe('INVITE');
    expect(classifyInvite({ ...base, invite: 'REVOKED', account: student })).toBe('ENROL');
    expect(classifyInvite({ ...base, invite: 'ENROLLED', account: student, enrolled: true })).toBe('ALREADY_ENROLLED');
  });

  it('a pending invite for a verified account is enrolled rather than reported as already invited', () => {
    // E.g. invited before signing up, and the account verified while the claim failed: enrolling fixes it.
    expect(classifyInvite({ ...base, invite: 'PENDING', account: student })).toBe('ENROL');
  });

  it('counts outcomes', () => {
    expect(countOutcomes([{ outcome: 'ENROL' }, { outcome: 'INVITE' }, { outcome: 'ENROL' }])).toEqual({ ENROL: 2, INVITE: 1 });
  });
});

describe('inviteApplySchema', () => {
  it('defaults to sending email, no payment waiver, English', () => {
    expect(inviteApplySchema.parse({ entries: [{ email: 'a@x.com' }] })).toMatchObject({ sendEmail: true, skipPayment: false, locale: 'en' });
  });

  it('caps the batch size', () => {
    expect(inviteApplySchema.safeParse({ entries: [] }).success).toBe(false);
    expect(inviteApplySchema.safeParse({ entries: Array.from({ length: 301 }, () => ({ email: 'a@x.com' })) }).success).toBe(false);
  });
});
