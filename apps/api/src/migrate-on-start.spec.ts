import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationsOnDisk, pendingMigrations } from './migrate-on-start';

describe('migrate on start', () => {
  it('finds the migrations shipped with the API', () => {
    const shipped = migrationsOnDisk(join(__dirname, '..', 'prisma', 'migrations'));
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped).toEqual([...shipped].sort());
  });

  it('only counts directories with a migration.sql, like the CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const name of ['20260101_a', '20260102_b']) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'migration.sql'), 'SELECT 1;');
    }
    mkdirSync(join(dir, 'not_a_migration'));
    writeFileSync(join(dir, 'migration_lock.toml'), '');
    expect(migrationsOnDisk(dir)).toEqual(['20260101_a', '20260102_b']);
    expect(migrationsOnDisk(join(dir, 'missing'))).toEqual([]);
  });

  it('runs the CLI only when something on disk is not applied', () => {
    expect(pendingMigrations(['a', 'b'], ['a', 'b'])).toEqual([]);
    // Applied rows the image doesn't know (a rollback to an older image) aren't "pending".
    expect(pendingMigrations(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
    expect(pendingMigrations(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c']);
    expect(pendingMigrations(['a'], [])).toEqual(['a']);
  });
});
