import { hash, verify } from '@node-rs/argon2';
import { BusyException } from '../common/busy';

/**
 * Password hashing (argon2id), with a gate in front.
 *
 * The cost stays at OWASP's recommendation (m = 19 MiB, t = 2, p = 1, which are also the
 * library's defaults, so existing hashes and new ones match). What changes is how many run at
 * once: each hash is ~CPU-bound work on libuv's thread pool (4 threads by default), and on a
 * ¼ vCPU container four parallel hashes simply share the same quarter of a CPU with the event
 * loop, so every other request stalls behind them. Running them one at a time
 * (PASSWORD_HASH_CONCURRENCY) gives the same throughput with the event loop left free, and a
 * queue bounded by expected wait (MAX_WAIT_MS) turns a login stampede into fast 503s with
 * Retry-After instead of 10–30 s waits.
 */
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Waiting hashes beyond this are refused at once, whatever their expected wait. */
export const MAX_QUEUE = 32;
/** A hash expected to wait longer than this (queue length × recent hash time) is refused at once. */
export const MAX_WAIT_MS = 5_000;

export class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  /** Recent duration of one job (moving average), to estimate the wait of a queued one. */
  private avgMs: number;

  constructor(
    private readonly concurrency: number,
    private readonly maxQueue: number,
    private readonly maxWaitMs = Infinity,
    initialAvgMs = 250,
  ) {
    this.avgMs = initialAvgMs;
  }

  get queued(): number {
    return this.waiting.length;
  }

  /** Expected wait for a job queued now. */
  expectedWaitMs(): number {
    return ((this.waiting.length + 1) * this.avgMs) / this.concurrency;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxQueue || this.expectedWaitMs() > this.maxWaitMs) throw new BusyException('password_hash', 5);
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    const started = Date.now();
    try {
      return await fn();
    } finally {
      this.avgMs = 0.8 * this.avgMs + 0.2 * (Date.now() - started);
      const nextUp = this.waiting.shift();
      // Hand the slot straight to the next waiter (active stays the same), or free it.
      if (nextUp) nextUp();
      else this.active--;
    }
  }
}

const concurrency = Number(process.env.PASSWORD_HASH_CONCURRENCY) || 1;
const gate = new Gate(concurrency, MAX_QUEUE, MAX_WAIT_MS);

export function hashPassword(password: string): Promise<string> {
  return gate.run(() => hash(password, ARGON2_OPTIONS));
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return gate.run(() => verify(passwordHash, password));
}
