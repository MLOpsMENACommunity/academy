import { describe, expect, it } from 'vitest';
import { googleCalendarUrl, isCarriedHash, liveLinkVisible, parseSessionHash, recordingKind, sessionPhase, youtubeId } from './learn';

describe('youtubeId / recordingKind', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s', (url, id) => {
    expect(youtubeId(url)).toBe(id);
    expect(recordingKind(url)).toBe('youtube');
  });
  it('recognises Drive and other links', () => {
    expect(recordingKind('https://drive.google.com/file/d/abc/view')).toBe('drive');
    expect(recordingKind('https://vimeo.com/1')).toBe('link');
    expect(youtubeId('not a url')).toBeNull();
  });
});

describe('session timing', () => {
  const start = new Date('2026-10-22T17:00:00Z');
  const at = (min: number) => new Date(start.getTime() + min * 60_000);
  it('computes the phase', () => {
    expect(sessionPhase(start, 120, at(-1))).toBe('upcoming');
    expect(sessionPhase(start, 120, at(60))).toBe('live');
    expect(sessionPhase(start, 120, at(121))).toBe('ended');
  });
  it('reveals the live link only inside the window', () => {
    expect(liveLinkVisible(start, 120, 60, at(-61))).toBe(false);
    expect(liveLinkVisible(start, 120, 60, at(-60))).toBe(true);
    expect(liveLinkVisible(start, 120, 60, at(149))).toBe(true);
    expect(liveLinkVisible(start, 120, 60, at(151))).toBe(false);
  });
});

describe('googleCalendarUrl', () => {
  it('builds a template link in UTC', () => {
    const url = googleCalendarUrl({ title: 'S1', startsAt: '2026-10-22T17:00:00.000Z', durationMin: 90, details: 'https://x' });
    expect(url).toContain('dates=20261022T170000Z%2F20261022T183000Z');
    expect(url).not.toContain('meet.google');
  });
});

describe('learn page deep links', () => {
  it('reads #session-N and #session-N-feedback', () => {
    expect(parseSessionHash('#session-3')).toEqual({ order: 3, feedback: false });
    expect(parseSessionHash('#session-12-feedback')).toEqual({ order: 12, feedback: true });
    expect(parseSessionHash('#session-x')).toBeNull();
    expect(parseSessionHash('#session-3-feedbackx')).toBeNull();
    expect(parseSessionHash('#reminders')).toBeNull();
  });

  it('carries only learn-page fragments through sign-in', () => {
    for (const h of ['#session-2', '#session-2-feedback', '#course-feedback', '#reminders']) expect(isCarriedHash(h)).toBe(true);
    for (const h of ['', '#', '#email=a%40b.c', '#session-', '#foo']) expect(isCarriedHash(h)).toBe(false);
  });
});
