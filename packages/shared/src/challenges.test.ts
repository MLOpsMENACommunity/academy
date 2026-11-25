import { describe, expect, it } from 'vitest';
import {
  canSubmit,
  challengeEntrySchema,
  challengeInputSchema,
  challengePhase,
  challengeReviewSchema,
  challengeUpdateSchema,
  isHttpsUrl,
} from './challenges';

const DAY = 86_400_000;
const now = new Date('2026-11-16T12:00:00Z');
const open = { status: 'PUBLISHED' as const, startsAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 6 * DAY) };

describe('challengePhase', () => {
  it('is upcoming before the start, open until the end (exclusive), closed after', () => {
    expect(challengePhase({ startsAt: new Date(now.getTime() + 1), endsAt: new Date(now.getTime() + DAY) }, now)).toBe('upcoming');
    expect(challengePhase({ startsAt: now, endsAt: new Date(now.getTime() + DAY) }, now)).toBe('open');
    expect(challengePhase({ startsAt: new Date(now.getTime() - DAY), endsAt: now }, now)).toBe('closed');
    expect(challengePhase({ startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-08T00:00:00Z' }, now)).toBe('closed');
  });
});

describe('canSubmit', () => {
  it('lets an eligible student submit while open, and resubmit a pending or rejected entry', () => {
    expect(canSubmit(open, true, null, now)).toEqual({ ok: true });
    expect(canSubmit(open, true, { status: 'PENDING' }, now)).toEqual({ ok: true });
    expect(canSubmit(open, true, { status: 'REJECTED' }, now)).toEqual({ ok: true });
  });

  it('refuses drafts and archived challenges, ineligible students, outside the window, and approved entries', () => {
    expect(canSubmit({ ...open, status: 'DRAFT' }, true, null, now)).toEqual({ ok: false, reason: 'NOT_PUBLISHED' });
    expect(canSubmit({ ...open, status: 'ARCHIVED' }, true, null, now)).toEqual({ ok: false, reason: 'NOT_PUBLISHED' });
    expect(canSubmit(open, false, null, now)).toEqual({ ok: false, reason: 'NOT_ELIGIBLE' });
    expect(canSubmit({ ...open, startsAt: new Date(now.getTime() + DAY), endsAt: new Date(now.getTime() + 2 * DAY) }, true, null, now)).toEqual({ ok: false, reason: 'NOT_STARTED' });
    expect(canSubmit({ ...open, endsAt: now }, true, { status: 'REJECTED' }, now)).toEqual({ ok: false, reason: 'CLOSED' });
    expect(canSubmit(open, true, { status: 'APPROVED' }, now)).toEqual({ ok: false, reason: 'ALREADY_APPROVED' });
  });
});

describe('challenge schemas', () => {
  const input = {
    courseId: '',
    slug: 'Deploy-A-Model',
    titleEn: 'Deploy a model in a week',
    titleAr: 'انشر نموذجًا في أسبوع',
    descriptionEn: 'Ship it.',
    descriptionAr: 'انشره.',
    startsAt: '2026-11-16T00:00:00Z',
    endsAt: '2026-11-23T00:00:00Z',
    points: '50',
  };

  it('parses a challenge: lower-case slug, no course, draft by default, a default icon', () => {
    const c = challengeInputSchema.parse(input);
    expect(c).toMatchObject({ courseId: null, slug: 'deploy-a-model', points: 50, status: 'DRAFT', icon: '🚀' });
    expect(c.startsAt).toBeInstanceOf(Date);
  });

  it('needs both languages, points 0–500, and an end after the start', () => {
    expect(challengeInputSchema.safeParse({ ...input, titleAr: '' }).success).toBe(false);
    expect(challengeInputSchema.safeParse({ ...input, points: 501 }).success).toBe(false);
    expect(challengeInputSchema.safeParse({ ...input, points: -1 }).success).toBe(false);
    expect(challengeInputSchema.safeParse({ ...input, points: 0 }).success).toBe(true);
    const r = challengeInputSchema.safeParse({ ...input, endsAt: input.startsAt });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['endsAt']);
    expect(challengeInputSchema.safeParse({ ...input, slug: 'no spaces' }).success).toBe(false);
  });

  it('never changes the slug or the course on an edit', () => {
    const u = challengeUpdateSchema.parse({ ...input, slug: 'other', courseId: 'c1', status: 'PUBLISHED' });
    expect(u).not.toHaveProperty('slug');
    expect(u).not.toHaveProperty('courseId');
    expect(u.status).toBe('PUBLISHED');
  });

  it('accepts only https links for entries', () => {
    expect(challengeEntrySchema.parse({ url: ' https://github.com/me/model ' })).toEqual({ url: 'https://github.com/me/model', note: '', showName: false });
    for (const url of ['http://github.com/me/model', 'javascript:alert(1)', 'ftp://example.com/x', 'https://user:pw@example.com/', 'https://localhost/x', 'https://example.com:8443/x', 'github.com/me', '']) {
      expect([url, challengeEntrySchema.safeParse({ url }).success]).toEqual([url, false]);
    }
    expect(challengeEntrySchema.safeParse({ url: `https://example.com/${'a'.repeat(500)}` }).success).toBe(false);
    expect(challengeEntrySchema.safeParse({ url: 'https://example.com', note: 'x'.repeat(1001) }).success).toBe(false);
    expect(isHttpsUrl('https://huggingface.co/spaces/me/demo')).toBe(true);
  });

  it('approves without feedback, and rejects only with feedback', () => {
    expect(challengeReviewSchema.parse({ decision: 'APPROVE' })).toEqual({ decision: 'APPROVE', feedback: '' });
    expect(challengeReviewSchema.safeParse({ decision: 'REJECT', feedback: '  ' }).success).toBe(false);
    expect(challengeReviewSchema.parse({ decision: 'REJECT', feedback: 'Add a README' }).feedback).toBe('Add a README');
    expect(challengeReviewSchema.safeParse({ decision: 'MAYBE' }).success).toBe(false);
    expect(challengeReviewSchema.safeParse({ decision: 'APPROVE', feedback: 'x'.repeat(1001) }).success).toBe(false);
  });
});
