import { DEFAULT_POOL_SIZE, DEFAULT_POOL_TIMEOUT_S, poolSettings } from './database-url';

const params = (url: string) => new URL(url).searchParams;

describe('poolSettings', () => {
  it('sets an explicit pool size and a short pool timeout by default', () => {
    const s = poolSettings('postgresql://u:p@localhost:5432/academy?schema=public');
    expect(s.connectionLimit).toBe(DEFAULT_POOL_SIZE);
    expect(s.poolTimeoutS).toBe(DEFAULT_POOL_TIMEOUT_S);
    expect(DEFAULT_POOL_TIMEOUT_S).toBeLessThan(10); // Prisma's default, the 10 s plateau
    const q = params(s.url);
    expect(q.get('connection_limit')).toBe(String(DEFAULT_POOL_SIZE));
    expect(q.get('pool_timeout')).toBe(String(DEFAULT_POOL_TIMEOUT_S));
    expect(q.get('schema')).toBe('public');
    expect(q.get('pgbouncer')).toBeNull();
  });

  it('uses DATABASE_POOL_SIZE / DATABASE_POOL_TIMEOUT when given', () => {
    const s = poolSettings('postgresql://u:p@localhost/db', { poolSize: 4, poolTimeoutS: 3 });
    expect([s.connectionLimit, s.poolTimeoutS]).toEqual([4, 3]);
  });

  it('never overrides values already in DATABASE_URL', () => {
    const s = poolSettings('postgresql://u:p@h/db?connection_limit=12&pool_timeout=7&sslmode=require', { poolSize: 4, poolTimeoutS: 3 });
    expect([s.connectionLimit, s.poolTimeoutS]).toEqual([12, 7]);
    expect(params(s.url).get('sslmode')).toBe('require');
  });

  it("leaves Prisma's pgbouncer mode off for Neon's pooler (PgBouncer 1.22+, prepared statements)", () => {
    const s = poolSettings('postgresql://u:p@ep-cool-name-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require');
    expect(s.pgbouncer).toBe(false);
    expect(params(s.url).get('pgbouncer')).toBeNull();
    // Still available when asked for: in the URL (wins) or by DB_PGBOUNCER.
    expect(poolSettings('postgresql://u:p@ep-x-pooler.aws.neon.tech/db?pgbouncer=true').pgbouncer).toBe(true);
    expect(poolSettings('postgresql://u:p@pgb.internal/db', { pgbouncer: true }).pgbouncer).toBe(true);
    expect(params(poolSettings('postgresql://u:p@pgb.internal/db', { pgbouncer: true }).url).get('pgbouncer')).toBe('true');
    expect(poolSettings('postgresql://u:p@pgb.internal/db?pgbouncer=false', { pgbouncer: true }).pgbouncer).toBe(false);
  });

  it('keeps credentials intact (URL-encoded passwords)', () => {
    const s = poolSettings('postgresql://user:p%40ss%2Fw0rd@localhost:5432/db');
    const u = new URL(s.url);
    expect(u.password).toBe('p%40ss%2Fw0rd');
    expect(u.username).toBe('user');
  });

  it('ignores invalid numbers in the URL', () => {
    const s = poolSettings('postgresql://u:p@h/db?connection_limit=abc&pool_timeout=0');
    expect([s.connectionLimit, s.poolTimeoutS]).toEqual([DEFAULT_POOL_SIZE, DEFAULT_POOL_TIMEOUT_S]);
  });
});
