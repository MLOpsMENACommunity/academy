import { describe, expect, it } from 'vitest';
import { createPositionTracker } from './position-tracker';

function setup() {
  let clock = 0;
  const saves: { body: unknown; keepalive: boolean }[] = [];
  const tracker = createPositionTracker((body, { keepalive }) => saves.push({ body, keepalive }), () => clock);
  return { tracker, saves, tick: (ms: number) => (clock += ms) };
}

describe('createPositionTracker', () => {
  it('saves nothing before the video has played in this visit', () => {
    const { tracker, saves } = setup();
    tracker.update({ currentTime: 0, duration: 600, playerState: -1 });
    tracker.update({ playerState: 5 });
    tracker.flush(true);
    expect(saves).toEqual([]);
  });

  it('saves at most every 15 s while playing', () => {
    const { tracker, saves, tick } = setup();
    tracker.update({ currentTime: 100, duration: 600, playerState: 1 });
    for (let i = 1; i <= 14; i++) {
      tick(1000);
      tracker.update({ currentTime: 100 + i });
    }
    expect(saves).toEqual([]);
    tick(1000);
    tracker.update({ currentTime: 115.6 });
    expect(saves).toEqual([{ body: { positionSec: 115, durationSec: 600 }, keepalive: false }]);
    tick(5000);
    tracker.update({ currentTime: 120 });
    expect(saves).toHaveLength(1);
  });

  it('saves on pause and at the end (the end as the full length)', () => {
    const { tracker, saves, tick } = setup();
    tracker.update({ currentTime: 10, duration: 300.4, playerState: 1 });
    tick(2000);
    tracker.update({ currentTime: 12 });
    tracker.update({ playerState: 2 });
    tracker.update({ playerState: 2 });
    tracker.update({ playerState: 1 });
    tracker.update({ currentTime: 299, playerState: 0 });
    expect(saves.map((s) => s.body)).toEqual([
      { positionSec: 12, durationSec: 300 },
      { positionSec: 300, durationSec: 300 },
    ]);
  });

  it('flushes with keepalive when the page goes, without repeating an unchanged second', () => {
    const { tracker, saves } = setup();
    tracker.update({ currentTime: 50.2, playerState: 1 });
    tracker.flush(true);
    tracker.flush(true);
    expect(saves).toEqual([{ body: { positionSec: 50 }, keepalive: true }]);
  });

  it('leaves out a length the API would refuse', () => {
    const { tracker, saves } = setup();
    tracker.update({ currentTime: 50, duration: 0.2, playerState: 1 });
    tracker.flush();
    expect(saves[0]!.body).toEqual({ positionSec: 50 });
  });
});
