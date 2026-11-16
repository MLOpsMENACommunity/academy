import { describe, expect, it } from 'vitest';
import { isVideoEndedMessage } from './youtube-messages';

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
