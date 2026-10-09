import { HttpStatus } from '@nestjs/common';
import { BusyException } from '../common/busy';
import { ARGON2_OPTIONS, Gate, hashPassword, verifyPassword } from './password-hasher';

const tick = () => new Promise((r) => setImmediate(r));

describe('password hashing', () => {
  it('keeps the OWASP argon2id cost (m=19 MiB, t=2, p=1)', async () => {
    expect(ARGON2_OPTIONS).toEqual({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });
});

describe('Gate', () => {
  it('runs at most `concurrency` at once, in order', async () => {
    const gate = new Gate(1, 10);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const releases: (() => void)[] = [];
    const job = (i: number) =>
      gate.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((r) => releases.push(r));
        order.push(i);
        running--;
      });
    const all = [job(1), job(2), job(3)];
    for (let i = 0; i < 3; i++) {
      await tick();
      releases.shift()?.();
    }
    await Promise.all(all);
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('refuses work beyond the queue with a fast 503 BUSY', async () => {
    const gate = new Gate(1, 1);
    let release!: () => void;
    const first = gate.run(() => new Promise<void>((r) => (release = r)));
    const second = gate.run(async () => 'queued');
    await expect(gate.run(async () => 'too many')).rejects.toBeInstanceOf(BusyException);
    try {
      await gate.run(async () => 'x');
    } catch (e) {
      expect((e as BusyException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
    release();
    await first;
    await expect(second).resolves.toBe('queued');
    expect(gate.queued).toBe(0);
  });

  it('frees the slot when the work fails', async () => {
    const gate = new Gate(1, 5);
    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('refuses a job whose expected wait is too long, even with room in the queue', async () => {
    const gate = new Gate(1, 100, 1_000, 400);
    let release!: () => void;
    const first = gate.run(() => new Promise<void>((r) => (release = r)));
    const second = gate.run(async () => 'a'); // expected wait 400 ms
    const third = gate.run(async () => 'b'); // 800 ms
    await expect(gate.run(async () => 'c')).rejects.toBeInstanceOf(BusyException); // 1 200 ms
    release();
    await first;
    await expect(Promise.all([second, third])).resolves.toEqual(['a', 'b']);
  });
});
