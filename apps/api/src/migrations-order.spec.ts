import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migration folders must be well-formed and in order: Prisma applies them by name, and a
 * migration that sorts before one already deployed is applied out of order (or reported as
 * drift). Each PR uses a pre-assigned timestamp slot; this catches typos and collisions.
 */
const dir = join(__dirname, '..', 'prisma', 'migrations');
const folders = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory());
/** Pairs that shipped with the same timestamp before this check existed (ordered by name). */
const LEGACY_SAME_TIMESTAMP = new Set(['20261014090000', '20261023090000']);

describe('migration folders', () => {
  it('are named <14-digit UTC timestamp>_<snake_case> with a real date', () => {
    for (const f of folders) {
      expect(f).toMatch(/^\d{14}_[a-z0-9]+(_[a-z0-9]+)*$/);
      const [, y, mo, d, h, mi, s] = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(f)!.map(Number);
      const date = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
      expect(date.getUTCMonth()).toBe(mo! - 1);
      expect(date.getUTCDate()).toBe(d!);
      expect(date.getUTCHours()).toBe(h!);
    }
  });

  it('have strictly increasing timestamps (no two PRs in the same slot)', () => {
    const stamps = folders.map((f) => f.slice(0, 14)).sort();
    for (let i = 1; i < stamps.length; i++) {
      if (LEGACY_SAME_TIMESTAMP.has(stamps[i]!) && stamps[i] === stamps[i - 1]) continue;
      expect(stamps[i]! > stamps[i - 1]!).toBe(true);
    }
  });

  it("sort after every migration on origin/main (when that ref is available, e.g. not in a shallow CI checkout)", () => {
    let onMain: string[];
    try {
      onMain = execFileSync('git', ['ls-tree', '--name-only', 'origin/main', `${join('apps', 'api', 'prisma', 'migrations')}/`], {
        cwd: join(__dirname, '..', '..', '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .map((p) => p.split('/').pop()!)
        .filter((f) => /^\d{14}_/.test(f));
    } catch {
      return; // no git or no origin/main: the two checks above still run
    }
    if (!onMain.length) return;
    const latest = [...onMain].sort().pop()!;
    const added = folders.filter((f) => !onMain.includes(f));
    for (const f of added) expect(`${f} > ${latest}: ${f > latest}`).toBe(`${f} > ${latest}: true`);
  });
});
