import { lockUrl, runKey } from './startup-tasks';

describe('startup tasks lock', () => {
  it('takes the lock on the direct connection, one connection only', () => {
    const url = lockUrl({ DATABASE_URL: 'postgresql://u:p@ep-x-pooler.aws.neon.tech/db', DIRECT_DATABASE_URL: 'postgresql://u:p@ep-x.aws.neon.tech/db' });
    expect(url).not.toBeNull();
    expect(new URL(url!).hostname).toBe('ep-x.aws.neon.tech');
    expect(new URL(url!).searchParams.get('connection_limit')).toBe('1');
    expect(lockUrl({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' })).toContain('connection_limit=1');
  });

  it('runs unlocked rather than take a session lock through PgBouncer', () => {
    expect(lockUrl({ DATABASE_URL: 'postgresql://u:p@ep-x-pooler.aws.neon.tech/db' })).toBeNull();
    expect(lockUrl({ DATABASE_URL: 'postgresql://u:p@pgb.internal/db?pgbouncer=true' })).toBeNull();
    expect(lockUrl({})).toBeNull();
  });
});

describe('startup tasks: once per release', () => {
  const env = { ACADEMY_RELEASE: 'abc123', SEED_ADMIN_EMAIL: 'admin@example.com' };
  it('always runs without a release (locally)', () => {
    expect(runKey({})).toBeNull();
    expect(runKey({ ACADEMY_RELEASE: '  ' })).toBeNull();
  });
  it('is stable for one release and its seed settings', () => {
    expect(runKey(env)).toBe(runKey({ ...env }));
    expect(runKey(env)).toMatch(/^abc123:[0-9a-f]{16}$/);
  });
  it('runs again after a deploy or a change the seed or the import reads', () => {
    const key = runKey(env);
    expect(runKey({ ...env, ACADEMY_RELEASE: 'def456' })).not.toBe(key);
    expect(runKey({ ...env, SEED_ADMIN_EMAIL: 'other@example.com' })).not.toBe(key);
    expect(runKey({ ...env, SEED_PLACEHOLDER_STATUS: 'COMING_SOON' })).not.toBe(key);
    expect(runKey({ ...env, ARCHIVE_IMPORT: 'false' })).not.toBe(key);
  });
});
