import { describe, expect, it } from 'vitest';
import {
  acceptAnswerSchema,
  answerSchema,
  askQuestionSchema,
  canEditPost,
  editQuestionSchema,
  editableUntil,
  nextQaStatus,
  qaExcerpt,
  qaListQuerySchema,
  QA_EDIT_WINDOW_MIN,
} from './qa';

describe('course Q&A', () => {
  it('lets the author edit for 30 minutes after posting', () => {
    const created = new Date('2026-11-16T10:00:00Z');
    expect(QA_EDIT_WINDOW_MIN).toBe(30);
    expect(editableUntil(created).toISOString()).toBe('2026-11-16T10:30:00.000Z');
    expect(canEditPost(created, new Date('2026-11-16T10:29:59Z'))).toBe(true);
    expect(canEditPost(created, new Date('2026-11-16T10:30:00Z'))).toBe(true);
    expect(canEditPost(created, new Date('2026-11-16T10:30:01Z'))).toBe(false);
    expect(canEditPost(created.toISOString(), new Date('2026-11-16T11:00:00Z'))).toBe(false);
  });

  it('is ANSWERED with a visible answer, OPEN without, and CLOSED stays closed', () => {
    expect(nextQaStatus('OPEN', true)).toBe('ANSWERED');
    expect(nextQaStatus('ANSWERED', false)).toBe('OPEN');
    expect(nextQaStatus('OPEN', false)).toBe('OPEN');
    expect(nextQaStatus('CLOSED', true)).toBe('CLOSED');
    expect(nextQaStatus('CLOSED', false)).toBe('CLOSED');
  });

  it('checks a question: a 5–150 character title, a body, an optional lesson', () => {
    expect(askQuestionSchema.parse({ title: '  How do I tag images?  ', body: ' Like this ', sessionId: '' })).toEqual({
      title: 'How do I tag images?',
      body: 'Like this',
      sessionId: null,
    });
    expect(askQuestionSchema.parse({ title: 'Valid title', body: 'x', sessionId: 's1' }).sessionId).toBe('s1');
    expect(askQuestionSchema.safeParse({ title: 'Why', body: 'x' }).success).toBe(false);
    expect(askQuestionSchema.safeParse({ title: 'x'.repeat(151), body: 'x' }).success).toBe(false);
    expect(askQuestionSchema.safeParse({ title: 'Valid title', body: '   ' }).success).toBe(false);
    expect(answerSchema.safeParse({ body: 'x'.repeat(5001) }).success).toBe(false);
    expect(answerSchema.safeParse({ body: 'x'.repeat(5000) }).success).toBe(true);
  });

  it('keeps the lesson on an edit unless one is sent', () => {
    expect(editQuestionSchema.parse({ title: 'Valid title', body: 'x' }).sessionId).toBeUndefined();
    expect(editQuestionSchema.parse({ title: 'Valid title', body: 'x', sessionId: null }).sessionId).toBeNull();
    expect(editQuestionSchema.parse({ title: 'Valid title', body: 'x', sessionId: '' }).sessionId).toBeNull();
  });

  it('reads the list query with defaults and limits', () => {
    expect(qaListQuerySchema.parse({})).toEqual({ filter: 'all', page: 1 });
    expect(qaListQuerySchema.parse({ filter: 'mine', page: '3', q: '  docker ', sessionId: 's1' })).toEqual({ filter: 'mine', page: 3, q: 'docker', sessionId: 's1' });
    expect(qaListQuerySchema.parse({ q: '   ', sessionId: '' })).toEqual({ filter: 'all', page: 1, q: undefined, sessionId: undefined });
    expect(qaListQuerySchema.safeParse({ filter: 'hidden' }).success).toBe(false);
    expect(qaListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(qaListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(acceptAnswerSchema.safeParse({ answerId: null }).success).toBe(true);
    expect(acceptAnswerSchema.safeParse({}).success).toBe(false);
  });

  it('makes a short plain-text excerpt of a markdown answer', () => {
    expect(qaExcerpt('Use **docker tag** and see [the docs](https://docs.docker.com).')).toBe('Use docker tag and see the docs.');
    expect(qaExcerpt('Run:\n```bash\ndocker build .\n```\nthen push')).toBe('Run: [code] then push');
    expect(qaExcerpt('# Title\n- one\n- two')).toBe('Title one two');
    const long = qaExcerpt('word '.repeat(100), 50);
    expect(long.length).toBeLessThanOrEqual(51);
    expect(long.endsWith('…')).toBe(true);
  });
});
