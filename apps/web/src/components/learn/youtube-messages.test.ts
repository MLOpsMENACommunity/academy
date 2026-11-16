import { describe, expect, it } from 'vitest';
import { isVideoEndedMessage, parsePlayerMessage, youtubeEmbedUrl } from './youtube-messages';

describe('isVideoEndedMessage', () => {
  it('recognises the end of the video, as a state change or a state report', () => {
    expect(isVideoEndedMessage(JSON.stringify({ event: 'onStateChange', info: 0 }))).toBe(true);
    expect(isVideoEndedMessage(JSON.stringify({ event: 'infoDelivery', info: { playerState: 0 } }))).toBe(true);
    expect(isVideoEndedMessage({ event: 'onStateChange', info: 0 })).toBe(true);
  });

  it('ignores every other state', () => {
    for (const state of [-1, 1, 2, 3, 5]) {
      expect(isVideoEndedMessage(JSON.stringify({ event: 'onStateChange', info: state }))).toBe(false);
      expect(isVideoEndedMessage(JSON.stringify({ event: 'infoDelivery', info: { playerState: state } }))).toBe(false);
    }
    expect(isVideoEndedMessage(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12 } }))).toBe(false);
  });

  it('ignores anything that is not a player message', () => {
    for (const raw of ['not json', '', null, undefined, 0, '0', JSON.stringify({ event: 'initialDelivery', info: { playerState: 0 } })]) {
      expect(isVideoEndedMessage(raw)).toBe(false);
    }
  });
});

describe('parsePlayerMessage', () => {
  it('reads the time, the length and the state from infoDelivery', () => {
    expect(parsePlayerMessage(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 42.5, duration: 600, playerState: 1 } }))).toEqual({
      currentTime: 42.5,
      duration: 600,
      playerState: 1,
    });
    expect(parsePlayerMessage({ event: 'infoDelivery', info: { currentTime: 3 } })).toEqual({ currentTime: 3 });
    expect(parsePlayerMessage(JSON.stringify({ event: 'onStateChange', info: 2 }))).toEqual({ playerState: 2 });
  });

  it('drops what is missing or nonsense', () => {
    expect(parsePlayerMessage({ event: 'infoDelivery', info: { currentTime: -1, duration: 'x', playerState: null, volume: 50 } })).toBeNull();
    expect(parsePlayerMessage({ event: 'infoDelivery', info: { currentTime: Number.NaN, duration: 10 } })).toEqual({ duration: 10 });
    for (const raw of ['not json', '', null, 7, JSON.stringify({ event: 'onStateChange', info: 'x' }), JSON.stringify({ event: 'initialDelivery', info: { currentTime: 1 } })]) {
      expect(parsePlayerMessage(raw)).toBeNull();
    }
  });
});

describe('youtubeEmbedUrl', () => {
  const origin = 'https://academy.mlopsmena.com';
  it('turns the JS API on for this origin, without autoplay', () => {
    const u = new URL(youtubeEmbedUrl('abc_DEF-123', origin));
    expect(u.origin + u.pathname).toBe('https://www.youtube-nocookie.com/embed/abc_DEF-123');
    expect(u.searchParams.get('enablejsapi')).toBe('1');
    expect(u.searchParams.get('origin')).toBe(origin);
    expect(u.searchParams.get('rel')).toBe('0');
    expect(u.searchParams.has('autoplay')).toBe(false);
    expect(u.searchParams.has('start')).toBe(false);
  });

  it('starts at whole seconds above 0, and autoplays only when asked', () => {
    const u = new URL(youtubeEmbedUrl('abc', origin, { start: 2527.8, autoplay: true }));
    expect(u.searchParams.get('start')).toBe('2527');
    expect(u.searchParams.get('autoplay')).toBe('1');
    expect(new URL(youtubeEmbedUrl('abc', origin, { start: 0 })).searchParams.has('start')).toBe(false);
  });
});
