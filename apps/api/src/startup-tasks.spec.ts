import { lockUrl } from './startup-tasks';

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
